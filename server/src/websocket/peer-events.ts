import { FastifyInstance } from 'fastify';
import { peerQueries } from '../db/index.js';
import { verifySignature } from '../services/peers.js';
import { streamLogs, deployProjectStream, downProjectStream } from '../services/docker.js';

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

      socket.on('message', async (data: Buffer | string) => {
        try {
          const message = JSON.parse(data.toString());

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
            if (deployStreamers.has(key)) return;
            const stop = deployProjectStream(
              projectId,
              (line) => {
                try { socket.send(JSON.stringify({ type: 'deploy_output', projectId, line })); } catch {}
              },
              (success) => {
                deployStreamers.delete(key);
                try { socket.send(JSON.stringify({ type: 'deploy_done', projectId, success })); } catch {}
              },
            );
            deployStreamers.set(key, stop);
          }

          if (message.type === 'abort_deploy' && message.projectId) {
            const key = `${clientId}:deploy:${Number(message.projectId)}`;
            const stop = deployStreamers.get(key);
            if (stop) { stop(); deployStreamers.delete(key); }
          }

          if (message.type === 'subscribe_down' && message.projectId) {
            const projectId = Number(message.projectId);
            const key = `${clientId}:down:${projectId}`;
            if (downStreamers.has(key)) return;
            const stop = downProjectStream(
              projectId,
              (line) => {
                try { socket.send(JSON.stringify({ type: 'down_output', projectId, line })); } catch {}
              },
              (success) => {
                downStreamers.delete(key);
                try { socket.send(JSON.stringify({ type: 'down_done', projectId, success })); } catch {}
              },
            );
            downStreamers.set(key, stop);
          }

          if (message.type === 'abort_down' && message.projectId) {
            const key = `${clientId}:down:${Number(message.projectId)}`;
            const stop = downStreamers.get(key);
            if (stop) { stop(); downStreamers.delete(key); }
          }
        } catch {}
      });

      socket.on('close', () => {
        logStreamers.forEach(stop => stop());
        deployStreamers.forEach(stop => stop());
        downStreamers.forEach(stop => stop());
      });

      socket.on('error', () => {});
    });
  });
}
