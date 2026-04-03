import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import staticFiles from '@fastify/static';
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));

import { authRoutes } from './routes/auth.js';
import { projectRoutes } from './routes/projects.js';
import { containerRoutes } from './routes/containers.js';
import { importRoutes } from './routes/import.js';
import { homeRoutes } from './routes/home.js';
import { systemRoutes } from './routes/system.js';
import { proxyRoutes } from './routes/proxy.js';
import { setupWebSocket } from './websocket/index.js';
import { watcher } from './services/watcher.js';
import { waitForDb, settingQueries, projectQueries } from './db/index.js';
import { startAutoUpdateChecker, performUpdate } from './services/updater.js';
import { initCaddyConfig } from './services/caddy.js';
import { checkProjectImageUpdates, updateProjectImages } from './services/docker.js';

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
fastify.register(systemRoutes);
fastify.register(proxyRoutes);

fastify.get('/api/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

fastify.get('/api/proxy/root-ca', async (_, reply) => {
  const certPath = '/app/caddy-data/caddy/pki/authorities/local/root.crt';
  try {
    const cert = await readFile(certPath);
    reply.header('Content-Type', 'application/x-pem-file');
    reply.header('Content-Disposition', 'attachment; filename="homer-root-ca.crt"');
    return reply.send(cert);
  } catch {
    return reply.status(404).send({ error: 'Certificat CA introuvable. Démarrez Caddy au moins une fois.' });
  }
});

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

const start = async () => {
  try {
    console.log('[Server] Waiting for database...');
    await waitForDb();
    console.log('[Server] Database ready');
    
    watcher.initialize();

    // Push Caddy config on startup (non-blocking if Caddy is unavailable)
    initCaddyConfig().catch(() => {});

    const port = parseInt(process.env.PORT || '4000');
    const host = process.env.HOST || '0.0.0.0';

    await fastify.listen({ port, host });
    console.log(`Server running on http://${host}:${port}`);

    startAutoUpdateChecker(
      (event) => fastify.broadcast(event),
      () => settingQueries.get('auto_update') === 'true',
      () => performUpdate(
        (line) => fastify.broadcast({ type: 'update_output', line }),
        () => fastify.broadcast({ type: 'update_pull_done' }),
        (message) => fastify.broadcast({ type: 'update_error', message }),
      ),
    );

    // Periodic image update checker
    const checkAllProjectUpdates = async () => {
      try {
        const projects = projectQueries.getAll();
        for (const project of projects) {
          const result = await checkProjectImageUpdates(project.id);
          settingQueries.set(`image_updates_${project.id}`, JSON.stringify({ ...result, checkedAt: Date.now() }));
          if (result.hasUpdates) {
            fastify.broadcast({ type: 'project_update_available', projectId: project.id, hasUpdates: true });
            // Auto-apply if the project has auto_update enabled and policy is not disabled
            if (project.auto_update && project.auto_update_policy !== 'disabled') {
              fastify.log.info(`[auto-update] Applying updates for project ${project.id} (${project.name})`);
              const updateResult = await updateProjectImages(project.id);
              if (updateResult.changed) {
                fastify.broadcast({ type: 'project_updated', projectId: project.id, changed: true });
                fastify.log.info(`[auto-update] Updated project ${project.id}: ${updateResult.output}`);
              }
            }
          }
        }
      } catch (err) {
        fastify.log.error('Image update check failed: %s', err instanceof Error ? err.message : String(err));
      }
    };
    // Initial check after 2 minutes, then at the configured interval (default 6 hours)
    const intervalRaw = settingQueries.get('update_check_interval');
    const intervalMinutes = intervalRaw ? Math.max(30, parseInt(intervalRaw, 10)) : 360;
    setTimeout(checkAllProjectUpdates, 2 * 60 * 1000);
    setInterval(checkAllProjectUpdates, intervalMinutes * 60 * 1000);
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
