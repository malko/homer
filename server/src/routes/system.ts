import { FastifyInstance, FastifyRequest } from 'fastify';
import { sessionQueries, settingQueries, projectQueries } from '../db/index.js';
import { checkForUpdate, performUpdate } from '../services/updater.js';
import { listContainers, getSystemStats } from '../services/docker.js';

const HOMER_CONTAINERS = ['homer-caddy', 'homelab-manager'];

export async function systemRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', async (request: FastifyRequest) => {
    const token = request.headers.authorization?.replace('Bearer ', '');
    const session = token ? sessionQueries.getByToken(token) : null;
    if (!session) {
      throw { statusCode: 401, message: 'Unauthorized' };
    }
  });

  fastify.get('/api/system/version', async () => {
    return checkForUpdate();
  });

  fastify.get('/api/system/settings', async () => {
    const autoUpdate = settingQueries.get('auto_update');
    const domainSuffix = settingQueries.get('caddy_domain_suffix') || '';
    const extraHostname = settingQueries.get('caddy_extra_hostname') || '';
    const raw = settingQueries.get('update_check_interval');
    const updateCheckInterval = raw ? parseInt(raw, 10) : 360;
    return {
      autoUpdate: autoUpdate === 'true',
      domainSuffix,
      extraHostname,
      updateCheckInterval: isNaN(updateCheckInterval) ? 360 : updateCheckInterval,
    };
  });

  fastify.put('/api/system/settings', async (request) => {
    const body = request.body as {
      autoUpdate?: boolean;
      domainSuffix?: string;
      extraHostname?: string;
      updateCheckInterval?: number;
    };
    if (body.autoUpdate !== undefined) {
      settingQueries.set('auto_update', body.autoUpdate ? 'true' : 'false');
    }
    if (body.domainSuffix !== undefined) {
      settingQueries.set('caddy_domain_suffix', body.domainSuffix);
    }
    if (body.extraHostname !== undefined) {
      settingQueries.set('caddy_extra_hostname', body.extraHostname);
    }
    if (body.updateCheckInterval !== undefined) {
      // Clamp to sensible range: 30 min – 7 days
      const minutes = Math.max(30, Math.min(10080, Math.round(body.updateCheckInterval)));
      settingQueries.set('update_check_interval', String(minutes));
    }
    return { success: true };
  });

  fastify.post('/api/system/update', async (_, reply) => {
    reply.status(202).send({ success: true });

    performUpdate(
      (line) => fastify.broadcast({ type: 'update_output', line }),
      () => fastify.broadcast({ type: 'update_pull_done' }),
      (message) => fastify.broadcast({ type: 'update_error', message }),
    );
  });

  fastify.get('/api/system/containers', async () => {
    const allContainers = await listContainers();
    return allContainers.filter(c => HOMER_CONTAINERS.includes(c.name));
  });

  fastify.get('/api/system/updates', async () => {
    const projects = projectQueries.getAll();
    const projectsWithUpdates: Array<{ id: number; name: string; services: string[] }> = [];

    for (const project of projects) {
      const stored = settingQueries.get(`image_updates_${project.id}`);
      if (stored) {
        try {
          const data = JSON.parse(stored) as { hasUpdates: boolean; services?: string[] };
          if (data.hasUpdates) {
            projectsWithUpdates.push({
              id: project.id,
              name: project.name,
              services: data.services || [],
            });
          }
        } catch {}
      }
    }

    return {
      hasUpdates: projectsWithUpdates.length > 0,
      projects: projectsWithUpdates,
    };
  });

  fastify.get('/api/system/stats', async () => {
    return getSystemStats();
  });
}
