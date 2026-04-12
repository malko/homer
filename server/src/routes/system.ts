import { FastifyInstance, FastifyRequest } from 'fastify';
import { sessionQueries, settingQueries, projectQueries } from '../db/index.js';
import { checkForUpdate, performUpdate } from '../services/updater.js';
import { listContainers, getSystemStats, listVolumes, listNetworks, listImages, pruneImages, removeContainer, updateContainerImage, removeNetwork, pruneNetworks, removeImage } from '../services/docker.js';
import { checkImageUpdateWithPolicy } from '../services/registry.js';

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
    const rawCertLifetime = settingQueries.get('caddy_cert_lifetime');
    const certLifetime = rawCertLifetime ? parseInt(rawCertLifetime, 10) : 10080;
    return {
      autoUpdate: autoUpdate === 'true',
      domainSuffix,
      extraHostname,
      updateCheckInterval: isNaN(updateCheckInterval) ? 360 : updateCheckInterval,
      certLifetime: isNaN(certLifetime) ? 10080 : certLifetime,
    };
  });

  fastify.put('/api/system/settings', async (request) => {
    const body = request.body as {
      autoUpdate?: boolean;
      domainSuffix?: string;
      extraHostname?: string;
      updateCheckInterval?: number;
      certLifetime?: number;
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
    if (body.certLifetime !== undefined) {
      // Clamp to sensible range: 1 hour – 30 days (in minutes)
      const minutes = Math.max(60, Math.min(43200, Math.round(body.certLifetime)));
      settingQueries.set('caddy_cert_lifetime', String(minutes));
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

  fastify.get('/api/system/volumes', async () => {
    return listVolumes();
  });

  fastify.get('/api/system/networks', async () => {
    return listNetworks();
  });

  fastify.get('/api/system/images', async () => {
    return listImages();
  });

  fastify.post('/api/system/images/prune', async (request) => {
    const { danglingOnly } = request.body as { danglingOnly?: boolean };
    return pruneImages(danglingOnly ?? true);
  });

  fastify.get('/api/system/all-containers', async () => {
    const containers = await listContainers();
    
    for (const container of containers) {
      if (container.image) {
        try {
          const updateInfo = await checkImageUpdateWithPolicy(container.image, 'all');
          (container as { hasUpdate?: boolean }).hasUpdate = updateInfo.hasUpdate;
        } catch {
          (container as { hasUpdate?: boolean }).hasUpdate = false;
        }
      }
    }
    
    return containers;
  });

  fastify.delete('/api/containers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await removeContainer(id);
      if (!result.success) {
        return reply.status(500).send(result);
      }
      fastify.broadcast({ type: 'containers_updated' });
      return result;
    } catch (error: unknown) {
      const err = error as { message?: string };
      return reply.status(500).send({ success: false, output: err.message || 'Failed to remove container' });
    }
  });

  fastify.post('/api/containers/:id/update-image', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await updateContainerImage(id);
      if (!result.success) {
        return reply.status(500).send(result);
      }
      fastify.broadcast({ type: 'containers_updated' });
      return result;
    } catch (error: unknown) {
      const err = error as { message?: string };
      return reply.status(500).send({ success: false, output: err.message || 'Failed to update container image' });
    }
  });

  fastify.delete('/api/system/networks/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    try {
      const result = await removeNetwork(name);
      if (!result.success) {
        return reply.status(500).send(result);
      }
      return result;
    } catch (error: unknown) {
      const err = error as { message?: string };
      return reply.status(500).send({ success: false, output: err.message || 'Failed to remove network' });
    }
  });

  fastify.post('/api/system/networks/prune', async () => {
    return pruneNetworks();
  });

  fastify.delete('/api/system/images/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { force } = request.query as { force?: string };
    try {
      const result = await removeImage(id, force === 'true');
      if (!result.success) {
        return reply.status(500).send(result);
      }
      return result;
    } catch (error: unknown) {
      const err = error as { message?: string };
      return reply.status(500).send({ success: false, output: err.message || 'Failed to remove image' });
    }
  });
}
