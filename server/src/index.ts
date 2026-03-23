import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import staticFiles from '@fastify/static';
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));

import { authRoutes } from './routes/auth.js';
import { projectRoutes } from './routes/projects.js';
import { containerRoutes } from './routes/containers.js';
import { importRoutes } from './routes/import.js';
import { homeRoutes } from './routes/home.js';
import { setupWebSocket } from './websocket/index.js';
import { watcher } from './services/watcher.js';
import { waitForDb } from './db/index.js';

const fastify = Fastify({
  logger: true,
});

await fastify.register(cors, {
  origin: true,
  credentials: true,
});

await fastify.register(websocket);

setupWebSocket(fastify);

fastify.decorate('watcher', watcher);

fastify.register(authRoutes);
fastify.register(projectRoutes);
fastify.register(containerRoutes);
fastify.register(importRoutes);
fastify.register(homeRoutes);

fastify.register(staticFiles, {
  root: '/app/web/dist',
  prefix: '/',
  wildcard: false,
  index: 'index.html',
});

fastify.get('/*', async (request, reply) => {
  if (request.url.startsWith('/api/')) {
    return reply.status(404).send({ error: 'Not found' });
  }
  return reply.sendFile('index.html');
});

fastify.get('/api/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

const start = async () => {
  try {
    console.log('[Server] Waiting for database...');
    await waitForDb();
    console.log('[Server] Database ready');
    
    watcher.initialize();
    
    const port = parseInt(process.env.PORT || '4000');
    const host = process.env.HOST || '0.0.0.0';
    
    await fastify.listen({ port, host });
    console.log(`Server running on http://${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

process.on('SIGINT', () => {
  watcher.close();
  fastify.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  watcher.close();
  fastify.close();
  process.exit(0);
});

start();
