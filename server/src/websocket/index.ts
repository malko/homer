import { FastifyInstance } from 'fastify';
import { WebSocket } from '@fastify/websocket';
import { createRequire } from 'module';
import { sessionQueries } from '../db/index.js';
import { streamLogs, deployProjectStream, downProjectStream } from '../services/docker.js';
import { getLocalInstance } from '../services/instance.js';
import { peerWsManager } from '../services/peer-ws.js';

// Minimal typing for node-pty (native module, installed separately)
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
// node-pty is a CJS native module — use createRequire for ESM compatibility
const require = createRequire(import.meta.url);
const pty = require('node-pty') as PtyModule;

interface BroadcastEvent {
  type: string;
  [key: string]: unknown;
}

const logStreamers = new Map<string, () => void>();
const terminalSessions = new Map<string, IPty>();
const deployStreamers = new Map<string, () => void>();
const downStreamers = new Map<string, () => void>();

export function setupWebSocket(fastify: FastifyInstance) {
  fastify.register(async (instance) => {
    instance.get('/api/events', { websocket: true }, (socket, request) => {
      const query = request.query as { token?: string };
      const token = query.token || request.headers.authorization?.replace('Bearer ', '');
      const session = token ? sessionQueries.getByToken(token) : null;
      if (!session) {
        socket.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
        socket.close();
        return;
      }

      const clientId = crypto.randomUUID();
      instance.wsClients.set(clientId, socket);

      socket.send(JSON.stringify({ type: 'connected', clientId }));

      socket.on('message', async (data: Buffer | string) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === 'subscribe_logs' && message.containerId) {
            const containerId = String(message.containerId);
            const peerUuid = message.peer_uuid as string | undefined;
            const local = getLocalInstance();
            if (peerUuid && peerUuid !== local.uuid) {
              const subKey = `${clientId}:${containerId}`;
              peerWsManager.subscribe(peerUuid, subKey,
                (event) => {
                  if (event['type'] === 'log_line' && event['containerId'] === containerId) {
                    try { socket.send(JSON.stringify(event)); } catch {}
                  }
                },
                { type: 'subscribe_logs', containerId },
                { type: 'unsubscribe_logs', containerId },
              );
            } else {
              const stopStreaming = await streamLogs(containerId, (line) => {
                try {
                  socket.send(JSON.stringify({
                    type: 'log_line', containerId, line,
                    timestamp: new Date().toISOString(),
                  }));
                } catch {}
              });
              logStreamers.set(`${clientId}:${containerId}`, stopStreaming);
            }
          }

          if (message.type === 'unsubscribe_logs' && message.containerId) {
            const containerId = String(message.containerId);
            const peerUuid = message.peer_uuid as string | undefined;
            const local = getLocalInstance();
            if (peerUuid && peerUuid !== local.uuid) {
              peerWsManager.unsubscribe(peerUuid, `${clientId}:${containerId}`);
            } else {
              const key = `${clientId}:${containerId}`;
              const stop = logStreamers.get(key);
              if (stop) { stop(); logStreamers.delete(key); }
            }
          }

          if (message.type === 'subscribe_terminal' && message.containerId) {
            const containerId = String(message.containerId);
            const key = `${clientId}:terminal:${containerId}`;

            // Kill existing session if any
            const existing = terminalSessions.get(key);
            if (existing) { try { existing.kill(); } catch {} terminalSessions.delete(key); }

            const cols = Number(message.cols) || 80;
            const rows = Number(message.rows) || 24;

            // Prefer bash (readline + completion); fall back to sh (busybox ash) if unavailable.
            // dash (Debian/Ubuntu /bin/sh) has no readline at all, hence no tab completion.
            const ptyProcess = pty.spawn('docker', ['exec', '-it', containerId,
              '/bin/sh', '-c', 'exec $(command -v bash || command -v sh)'], {
              name: 'xterm-256color',
              cols,
              rows,
              cwd: process.env.HOME ?? '/',
              env: { ...process.env, TERM: 'xterm-256color' },
            });
            terminalSessions.set(key, ptyProcess);

            ptyProcess.onData((data: string) => {
              try {
                socket.send(JSON.stringify({
                  type: 'terminal_output',
                  containerId,
                  // Encode as base64 to safely transmit raw binary PTY data
                  data: Buffer.from(data, 'binary').toString('base64'),
                }));
              } catch {}
            });

            ptyProcess.onExit(({ exitCode }) => {
              terminalSessions.delete(key);
              try {
                socket.send(JSON.stringify({ type: 'terminal_exit', containerId, code: exitCode }));
              } catch {}
            });
          }

          if (message.type === 'terminal_input' && message.containerId && message.data) {
            const key = `${clientId}:terminal:${String(message.containerId)}`;
            const ptyProcess = terminalSessions.get(key);
            if (ptyProcess) {
              // data is a raw binary string (not base64) sent directly by xterm.js onData
              ptyProcess.write(String(message.data));
            }
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

          if (message.type === 'subscribe_deploy' && message.projectId) {
            const projectId = Number(message.projectId);
            const peerUuid = message.peer_uuid as string | undefined;
            const local = getLocalInstance();
            if (peerUuid && peerUuid !== local.uuid) {
              const subKey = `${clientId}:deploy:${projectId}`;
              peerWsManager.subscribe(peerUuid, subKey,
                (event) => {
                  if ((event['type'] === 'deploy_output' || event['type'] === 'deploy_done') && event['projectId'] === projectId) {
                    try { socket.send(JSON.stringify(event)); } catch {}
                  }
                },
                { type: 'subscribe_deploy', projectId },
                { type: 'abort_deploy', projectId },
              );
            } else {
              const key = `${clientId}:deploy:${projectId}`;
              const existing = deployStreamers.get(key);
              if (existing) { existing(); deployStreamers.delete(key); }
              const stop = deployProjectStream(
                projectId,
                (line) => {
                  try { socket.send(JSON.stringify({ type: 'deploy_output', projectId, line })); } catch {}
                },
                (success) => {
                  deployStreamers.delete(key);
                  try { socket.send(JSON.stringify({ type: 'deploy_done', projectId, success })); } catch {}
                  if (success) instance.broadcast({ type: 'containers_updated' });
                },
              );
              deployStreamers.set(key, stop);
            }
          }

          if (message.type === 'abort_deploy' && message.projectId) {
            const projectId = Number(message.projectId);
            const peerUuid = message.peer_uuid as string | undefined;
            const local = getLocalInstance();
            if (peerUuid && peerUuid !== local.uuid) {
              peerWsManager.unsubscribe(peerUuid, `${clientId}:deploy:${projectId}`);
            } else {
              const key = `${clientId}:deploy:${projectId}`;
              const stop = deployStreamers.get(key);
              if (stop) { stop(); deployStreamers.delete(key); }
            }
          }

          if (message.type === 'subscribe_down' && message.projectId) {
            const projectId = Number(message.projectId);
            const peerUuid = message.peer_uuid as string | undefined;
            const local = getLocalInstance();
            if (peerUuid && peerUuid !== local.uuid) {
              const subKey = `${clientId}:down:${projectId}`;
              peerWsManager.subscribe(peerUuid, subKey,
                (event) => {
                  if ((event['type'] === 'down_output' || event['type'] === 'down_done') && event['projectId'] === projectId) {
                    try { socket.send(JSON.stringify(event)); } catch {}
                  }
                },
                { type: 'subscribe_down', projectId },
                { type: 'abort_down', projectId },
              );
            } else {
              const key = `${clientId}:down:${projectId}`;
              const existing = downStreamers.get(key);
              if (existing) { existing(); downStreamers.delete(key); }
              const stop = downProjectStream(
                projectId,
                (line) => {
                  try { socket.send(JSON.stringify({ type: 'down_output', projectId, line })); } catch {}
                },
                (success) => {
                  downStreamers.delete(key);
                  try { socket.send(JSON.stringify({ type: 'down_done', projectId, success })); } catch {}
                  if (success) instance.broadcast({ type: 'containers_updated' });
                },
              );
              downStreamers.set(key, stop);
            }
          }

          if (message.type === 'abort_down' && message.projectId) {
            const projectId = Number(message.projectId);
            const peerUuid = message.peer_uuid as string | undefined;
            const local = getLocalInstance();
            if (peerUuid && peerUuid !== local.uuid) {
              peerWsManager.unsubscribe(peerUuid, `${clientId}:down:${projectId}`);
            } else {
              const key = `${clientId}:down:${projectId}`;
              const stop = downStreamers.get(key);
              if (stop) { stop(); downStreamers.delete(key); }
            }
          }
        } catch {}
      });

      socket.on('close', () => {
        logStreamers.forEach((stop, key) => {
          if (key.startsWith(clientId)) stop();
        });
        deployStreamers.forEach((stop, key) => {
          if (key.startsWith(clientId)) { stop(); deployStreamers.delete(key); }
        });
        downStreamers.forEach((stop, key) => {
          if (key.startsWith(clientId)) { stop(); downStreamers.delete(key); }
        });
        const termKeysToDelete: string[] = [];
        terminalSessions.forEach((proc, key) => {
          if (key.startsWith(clientId + ':terminal:')) {
            try { proc.kill(); } catch {}
            termKeysToDelete.push(key);
          }
        });
        termKeysToDelete.forEach(key => terminalSessions.delete(key));
        peerWsManager.cleanupClient(clientId);
        instance.wsClients.delete(clientId);
      });

      socket.on('error', () => {
        instance.wsClients.delete(clientId);
      });
    });
  });

  fastify.decorate('wsClients', new Map<string, WebSocket>());
  fastify.decorate('broadcast', (event: BroadcastEvent) => {
    const message = JSON.stringify(event);
    fastify.wsClients.forEach((client) => {
      try { client.send(message); } catch {}
    });
  });

  setInterval(async () => {
    try {
      const { listContainers } = await import('../services/docker.js');
      const containers = await listContainers();
      fastify.broadcast({ type: 'heartbeat', containers });
    } catch {}
  }, 10000);
}

declare module 'fastify' {
  interface FastifyInstance {
    wsClients: Map<string, WebSocket>;
    broadcast: (event: BroadcastEvent) => void;
  }
}
