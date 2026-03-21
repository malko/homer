import { FastifyInstance } from 'fastify';
import { WebSocket } from '@fastify/websocket';
import { sessionQueries } from '../db/index.js';
import { streamLogs } from '../services/docker.js';

interface BroadcastEvent {
  type: string;
  [key: string]: unknown;
}

const logStreamers = new Map<string, () => void>();

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
            const containerId = message.containerId;
            const stopStreaming = await streamLogs(containerId, (line) => {
              try {
                socket.send(JSON.stringify({
                  type: 'log_line',
                  containerId,
                  line,
                  timestamp: new Date().toISOString(),
                }));
              } catch {}
            });
            
            logStreamers.set(`${clientId}:${containerId}`, stopStreaming);
          }
          
          if (message.type === 'unsubscribe_logs' && message.containerId) {
            const key = `${clientId}:${message.containerId}`;
            const stop = logStreamers.get(key);
            if (stop) {
              stop();
              logStreamers.delete(key);
            }
          }
        } catch {}
      });

      socket.on('close', () => {
        logStreamers.forEach((stop, key) => {
          if (key.startsWith(clientId)) {
            stop();
          }
        });
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
      try {
        client.send(message);
      } catch {}
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
