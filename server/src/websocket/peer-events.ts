import { FastifyInstance } from 'fastify';
import { createRequire } from 'module';
import { peerQueries, settingQueries } from '../db/index.js';
import { verifySignature } from '../services/peers.js';
import { streamLogs, deployProjectStream, downProjectStream, updateProjectImagesStream, listContainers } from '../services/docker.js';

interface IPty {
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (e: { exitCode: number }) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: (signal?: string) => void;
}
interface PtyModule {
  spawn: (file: string, args: string[], options: {
    name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv;
  }) => IPty;
}
const require = createRequire(import.meta.url);
const pty = require('node-pty') as PtyModule;

export function setupPeerEventsWs(fastify: FastifyInstance) {
  fastify.register(async (instance) => {
    instance.get('/api/peer-events', { websocket: true }, async (socket, request) => {
      const query = request.query as {
        peer_uuid?: string;
        timestamp?: string;
        signature?: string;
      };

      const peer = query.peer_uuid ? peerQueries.getByUuid(query.peer_uuid) : null;
      const timestamp = Number(query.timestamp);

      if (!peer || !verifySignature(peer.shared_secret, '', timestamp, query.signature ?? '')) {
        socket.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
        socket.close();
        return;
      }

      const clientId = `peer:${peer.peer_uuid}:${crypto.randomUUID()}`;
      const logStreamers = new Map<string, () => void>();
      const deployStreamers = new Map<string, () => void>();
      const downStreamers = new Map<string, () => void>();
      const updateStreamers = new Map<string, () => void>();
      const terminalSessions = new Map<string, IPty>();
      let heartbeatTimer: NodeJS.Timeout | null = null;
      let containersCheckTimer: NodeJS.Timeout | null = null;
      let containersSubscribed = false;
      let lastContainersJson = '';

      socket.on('message', async (data: Buffer | string) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type !== 'terminal_input' && message.type !== 'terminal_resize') {
            console.log(`[peer-events] recv from ${peer.peer_name}: type=${message.type} ${message.containerId ? `container=${String(message.containerId).slice(0,12)}` : ''}${message.projectId ? ` projectId=${message.projectId}` : ''}`);
          }

          if (message.type === 'subscribe_heartbeat') {
            if (heartbeatTimer) return;
            // Send immediately, then every 10s
            const sendHeartbeat = async () => {
              try {
                const containers = await listContainers();
                socket.send(JSON.stringify({ type: 'heartbeat', containers }));
              } catch {}
            };
            sendHeartbeat();
            heartbeatTimer = setInterval(sendHeartbeat, 10_000);
          }

          if (message.type === 'unsubscribe_heartbeat') {
            if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
          }

          if (message.type === 'subscribe_containers') {
            containersSubscribed = true;
            if (!containersCheckTimer) {
              const checkContainers = async () => {
                try {
                  const containers = await listContainers();
                  const json = JSON.stringify(containers);
                  if (json !== lastContainersJson) {
                    lastContainersJson = json;
                    socket.send(JSON.stringify({ type: 'containers_updated', containers }));
                  }
                } catch {}
              };
              checkContainers();
              containersCheckTimer = setInterval(checkContainers, 2_000);
            }
          }

          if (message.type === 'unsubscribe_containers') {
            containersSubscribed = false;
            if (containersCheckTimer) { clearInterval(containersCheckTimer); containersCheckTimer = null; }
            lastContainersJson = '';
          }

          if (message.type === 'subscribe_logs' && message.containerId) {
            const containerId = String(message.containerId);
            const key = `${clientId}:${containerId}`;
            if (logStreamers.has(key)) return;
            const stop = await streamLogs(containerId, (line) => {
              try {
                socket.send(JSON.stringify({
                  type: 'log_line', containerId, line,
                  timestamp: new Date().toISOString(),
                }));
              } catch {}
            });
            logStreamers.set(key, stop);
          }

          if (message.type === 'unsubscribe_logs' && message.containerId) {
            const key = `${clientId}:${String(message.containerId)}`;
            const stop = logStreamers.get(key);
            if (stop) { stop(); logStreamers.delete(key); }
          }

          if (message.type === 'subscribe_deploy' && message.projectId) {
            const projectId = Number(message.projectId);
            const key = `${clientId}:deploy:${projectId}`;
            if (deployStreamers.has(key)) {
              console.log(`[peer-events] subscribe_deploy duplicate projectId=${projectId} — ignored`);
              return;
            }
            try {
              const stop = deployProjectStream(
                projectId,
                (line) => {
                  try { socket.send(JSON.stringify({ type: 'deploy_output', projectId, line })); } catch {}
                },
                (success) => {
                  deployStreamers.delete(key);
                  console.log(`[peer-events] deploy done projectId=${projectId} success=${success}`);
                  try { socket.send(JSON.stringify({ type: 'deploy_done', projectId, success })); } catch {}
                },
              );
              deployStreamers.set(key, stop);
              console.log(`[peer-events] deploy started projectId=${projectId}`);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`[peer-events] deploy spawn FAILED projectId=${projectId}: ${msg}`);
              try { socket.send(JSON.stringify({ type: 'deploy_output', projectId, line: `Error: ${msg}` })); } catch {}
              try { socket.send(JSON.stringify({ type: 'deploy_done', projectId, success: false })); } catch {}
            }
          }

          if (message.type === 'abort_deploy' && message.projectId) {
            const key = `${clientId}:deploy:${Number(message.projectId)}`;
            const stop = deployStreamers.get(key);
            if (stop) { stop(); deployStreamers.delete(key); }
          }

          if (message.type === 'subscribe_down' && message.projectId) {
            const projectId = Number(message.projectId);
            const key = `${clientId}:down:${projectId}`;
            if (downStreamers.has(key)) {
              console.log(`[peer-events] subscribe_down duplicate projectId=${projectId} — ignored`);
              return;
            }
            try {
              const stop = downProjectStream(
                projectId,
                (line) => {
                  try { socket.send(JSON.stringify({ type: 'down_output', projectId, line })); } catch {}
                },
                (success) => {
                  downStreamers.delete(key);
                  console.log(`[peer-events] down done projectId=${projectId} success=${success}`);
                  try { socket.send(JSON.stringify({ type: 'down_done', projectId, success })); } catch {}
                },
              );
              downStreamers.set(key, stop);
              console.log(`[peer-events] down started projectId=${projectId}`);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`[peer-events] down spawn FAILED projectId=${projectId}: ${msg}`);
              try { socket.send(JSON.stringify({ type: 'down_output', projectId, line: `Error: ${msg}` })); } catch {}
              try { socket.send(JSON.stringify({ type: 'down_done', projectId, success: false })); } catch {}
            }
          }

          if (message.type === 'abort_down' && message.projectId) {
            const key = `${clientId}:down:${Number(message.projectId)}`;
            const stop = downStreamers.get(key);
            if (stop) { stop(); downStreamers.delete(key); }
          }

          if (message.type === 'subscribe_update' && message.projectId) {
            const projectId = Number(message.projectId);
            const key = `${clientId}:update:${projectId}`;
            if (updateStreamers.has(key)) {
              console.log(`[peer-events] subscribe_update duplicate projectId=${projectId} — ignored`);
              return;
            }
            try {
              const stop = updateProjectImagesStream(
                projectId,
                (line) => {
                  try { socket.send(JSON.stringify({ type: 'update_output', projectId, line })); } catch {}
                },
                (success, changed) => {
                  updateStreamers.delete(key);
                  console.log(`[peer-events] update done projectId=${projectId} success=${success} changed=${changed}`);
                  try { socket.send(JSON.stringify({ type: 'update_done', projectId, success, changed })); } catch {}
                  if (success) {
                    settingQueries.set(`image_updates_${projectId}`, JSON.stringify({ hasUpdates: false, services: [], checkedAt: Date.now() }));
                  }
                },
              );
              updateStreamers.set(key, stop);
              console.log(`[peer-events] update started projectId=${projectId}`);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`[peer-events] update spawn FAILED projectId=${projectId}: ${msg}`);
              try { socket.send(JSON.stringify({ type: 'update_output', projectId, line: `Error: ${msg}` })); } catch {}
              try { socket.send(JSON.stringify({ type: 'update_done', projectId, success: false, changed: false })); } catch {}
            }
          }

          if (message.type === 'abort_update' && message.projectId) {
            const key = `${clientId}:update:${Number(message.projectId)}`;
            const stop = updateStreamers.get(key);
            if (stop) { stop(); updateStreamers.delete(key); }
          }

          if (message.type === 'subscribe_terminal' && message.containerId) {
            const containerId = String(message.containerId);
            const key = `${clientId}:terminal:${containerId}`;
            const existing = terminalSessions.get(key);
            if (existing) { try { existing.kill(); } catch {} terminalSessions.delete(key); }

            const cols = Number(message.cols) || 80;
            const rows = Number(message.rows) || 24;

            try {
              const ptyProcess = pty.spawn('docker', ['exec', '-it', containerId,
                '/bin/sh', '-c', 'exec $(command -v bash || command -v sh)'], {
                name: 'xterm-256color',
                cols,
                rows,
                cwd: process.env.HOME ?? '/',
                env: { ...process.env, TERM: 'xterm-256color' },
              });
              terminalSessions.set(key, ptyProcess);
              console.log(`[peer-events] terminal PTY spawned for container=${containerId.slice(0,12)}`);

              ptyProcess.onData((data: string) => {
                try {
                  socket.send(JSON.stringify({
                    type: 'terminal_output',
                    containerId,
                    data: Buffer.from(data, 'binary').toString('base64'),
                  }));
                } catch {}
              });

              ptyProcess.onExit(({ exitCode }) => {
                terminalSessions.delete(key);
                console.log(`[peer-events] terminal PTY exit code=${exitCode} container=${containerId.slice(0,12)}`);
                try { socket.send(JSON.stringify({ type: 'terminal_exit', containerId, code: exitCode })); } catch {}
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`[peer-events] terminal spawn FAILED for container=${containerId.slice(0,12)}: ${msg}`);
              try { socket.send(JSON.stringify({ type: 'error', message: `Terminal spawn failed: ${msg}` })); } catch {}
              try { socket.send(JSON.stringify({ type: 'terminal_exit', containerId, code: 1 })); } catch {}
            }
          }

          if (message.type === 'terminal_input' && message.containerId && message.data) {
            const key = `${clientId}:terminal:${String(message.containerId)}`;
            const ptyProcess = terminalSessions.get(key);
            if (ptyProcess) ptyProcess.write(String(message.data));
          }

          if (message.type === 'terminal_resize' && message.containerId) {
            const key = `${clientId}:terminal:${String(message.containerId)}`;
            const ptyProcess = terminalSessions.get(key);
            const cols = Number(message.cols);
            const rows = Number(message.rows);
            if (ptyProcess && cols > 0 && rows > 0) {
              try { ptyProcess.resize(cols, rows); } catch {}
            }
          }

          if (message.type === 'unsubscribe_terminal' && message.containerId) {
            const key = `${clientId}:terminal:${String(message.containerId)}`;
            const ptyProcess = terminalSessions.get(key);
            if (ptyProcess) { try { ptyProcess.kill(); } catch {} terminalSessions.delete(key); }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[peer-events] message handler error from ${peer.peer_name}: ${msg}`);
          try { socket.send(JSON.stringify({ type: 'error', message: `Peer handler error: ${msg}` })); } catch {}
        }
      });

      socket.on('close', () => {
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
        if (containersCheckTimer) { clearInterval(containersCheckTimer); containersCheckTimer = null; }
        logStreamers.forEach(stop => stop());
        deployStreamers.forEach(stop => stop());
        downStreamers.forEach(stop => stop());
        updateStreamers.forEach(stop => stop());
        terminalSessions.forEach(proc => { try { proc.kill(); } catch {} });
      });

      socket.on('error', (err: Error) => {
        console.error(`[peer-events] WebSocket error from peer ${peer.peer_name}:`, err.message);
      });
    });
  });
}
