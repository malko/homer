import { FastifyInstance } from 'fastify';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { settingQueries, projectQueries, containerUpdateQueries } from '../db/index.js';
import { requireSession } from '../middleware/require-session.js';
import { systemSettingsSchema } from './request-schemas.js';
import { checkForUpdate, performUpdate, restartInstance } from '../services/updater.js';
import { getOwnComposeInfo, getOwnImage } from '../services/compose-discovery.js';
import { buildApplyPlan } from '../services/mount-override.js';

const execFileAsync = promisify(execFile);
import { syncConfig } from '../services/caddy.js';
import { listContainers, getSystemStats, listVolumes, listNetworks, listImages, pruneImages, removeContainer, updateContainerImage, removeNetwork, pruneNetworks, removeImage, checkContainerUpdate, checkAllContainerUpdates, removeVolume, pruneVolumes } from '../services/docker.js';
import { checkImageUpdateWithPolicy } from '../services/registry.js';

const HOMER_CONTAINERS = ['homer-caddy', 'homer'];

export async function systemRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireSession);

  fastify.get('/api/system/version', async () => {
    return checkForUpdate();
  });

  fastify.get('/api/system/settings', async () => {
    const autoUpdate = settingQueries.get('auto_update');
    const domainSuffix = settingQueries.get('caddy_domain_suffix') || '';
    const extraHostname = settingQueries.get('caddy_extra_hostname') || '';
    const raw = settingQueries.get('update_check_interval');
    const updateCheckInterval = raw ? parseInt(raw, 10) : 10080;
    const rawCertLifetime = settingQueries.get('caddy_cert_lifetime');
    const certLifetime = rawCertLifetime ? parseInt(rawCertLifetime, 10) : 10080;
    const homerHttpDisabled = settingQueries.get('homer_disable_http');
    return {
      autoUpdate: autoUpdate === 'true',
      domainSuffix,
      extraHostname,
      updateCheckInterval: isNaN(updateCheckInterval) ? 360 : updateCheckInterval,
      certLifetime: isNaN(certLifetime) ? 10080 : certLifetime,
      homerDisableHttp: homerHttpDisabled === 'true',
    };
  });

  fastify.put('/api/system/settings', async (request, reply) => {
    const parsed = systemSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }
    const body = parsed.data;
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
      // Clamp to sensible range: 30 min – 30 days
      const minutes = Math.max(30, Math.min(43200, Math.round(body.updateCheckInterval)));
      settingQueries.set('update_check_interval', String(minutes));
    }
    if (body.certLifetime !== undefined) {
      // Clamp to sensible range: 1 hour – 30 days (in minutes)
      const minutes = Math.max(60, Math.min(43200, Math.round(body.certLifetime)));
      settingQueries.set('caddy_cert_lifetime', String(minutes));
    }
    if (body.homerDisableHttp !== undefined) {
      settingQueries.set('homer_disable_http', body.homerDisableHttp ? 'true' : 'false');
      // Reload Caddy config to apply HTTP access changes
      syncConfig().catch(() => {});
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

  fastify.post('/api/system/restart', async (_, reply) => {
    reply.status(202).send({ success: true });

    restartInstance(
      (line) => fastify.broadcast({ type: 'restart_output', line }),
      () => fastify.broadcast({ type: 'restart_done' }),
      (message) => fastify.broadcast({ type: 'restart_error', message }),
    );
  });

  // Recreate Homer's own stack so a freshly written docker-compose.override.yml
  // (external project mounts) takes effect. Homer cannot read its own compose
  // dir, and a plain `docker restart` would not apply new volumes — so this
  // runs `docker compose up -d` from a detached helper container that mounts
  // the compose dir host-side and outlives Homer's own recreation.
  fastify.post('/api/system/apply-mount-override', async (_, reply) => {
    const own = await getOwnComposeInfo();
    const plan = buildApplyPlan(own);
    if (!plan) {
      return reply.status(400).send({ error: 'Homer is not running as a compose-managed container' });
    }
    const image = await getOwnImage();
    if (!image) {
      return reply.status(400).send({ error: "Could not determine Homer's own image" });
    }

    const mountArgs = plan.mountDirs.flatMap(d => ['-v', `${d}:${d}`]);

    // Homer itself cannot read the override file — probe its existence through
    // a short-lived helper container before triggering a restart for nothing.
    try {
      await execFileAsync('docker', ['run', '--rm', ...mountArgs, '--entrypoint', 'test', image, '-f', plan.overrideFile], { timeout: 60000 });
    } catch {
      return reply.status(400).send({ error: `Override file not found: ${plan.overrideFile}. Create it first, then retry.` });
    }

    try {
      await execFileAsync('docker', [
        'run', '-d', '--rm',
        '-v', '/var/run/docker.sock:/var/run/docker.sock',
        ...mountArgs,
        '-w', plan.cwd,
        '--entrypoint', 'docker',
        image,
        ...plan.composeArgs,
      ], { timeout: 60000 });
    } catch (error: unknown) {
      const err = error as { stderr?: string; message?: string };
      return reply.status(500).send({ error: err.stderr || err.message || 'Failed to launch the restart helper' });
    }

    return { success: true };
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

  fastify.get('/api/system/container-updates', async () => {
    const updates = containerUpdateQueries.getAll();
    const result: Record<string, { hasUpdate: boolean; checkedAt: number | null }> = {};
    for (const [containerId, update] of Object.entries(updates)) {
      result[containerId] = { hasUpdate: update.has_update === 1, checkedAt: update.checked_at };
    }
    return result;
  });

  fastify.post('/api/system/check-all-updates', async () => {
    const results = await checkAllContainerUpdates();
    for (const [containerId, data] of Object.entries(results)) {
      containerUpdateQueries.set(containerId, data.image, data.hasUpdate);
    }
    return { success: true, checked: Object.keys(results).length };
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

  fastify.post('/api/system/volumes/prune', async () => {
    return pruneVolumes();
  });

  fastify.delete('/api/system/volumes/:name', async (request) => {
    const { name } = request.params as { name: string };
    return removeVolume(name);
  });

  fastify.get('/api/system/all-containers', async (request) => {
    const { search, project, hasUpdate, includeUpdates, state } = request.query as {
      search?: string;
      project?: string;
      hasUpdate?: string;
      includeUpdates?: string;
      state?: string;
    };

    const allContainers = await listContainers();
    let containers = allContainers;

    if (search) {
      const searchLower = search.toLowerCase();
      containers = containers.filter(c => 
        c.name.toLowerCase().includes(searchLower) ||
        c.image.toLowerCase().includes(searchLower)
      );
    }

    if (project && project !== 'all') {
      containers = containers.filter(c => c.project === project);
    }

    if (state && state !== 'all') {
      containers = containers.filter(c => c.state === state);
    }

    if (includeUpdates === 'true') {
      const checkPromises = containers.map(async (container) => {
        if (container.image) {
          try {
            const updateInfo = await checkImageUpdateWithPolicy(container.image, 'all');
            (container as { hasUpdate?: boolean }).hasUpdate = updateInfo.hasUpdate;
          } catch {
            (container as { hasUpdate?: boolean }).hasUpdate = false;
          }
        }
      });
      await Promise.all(checkPromises);

      if (hasUpdate === 'true') {
        const ids = containers.filter(c => c.hasUpdate === true).map(c => c.id);
        return { containerIds: ids };
      }
    } else if (hasUpdate === 'true') {
      return { containerIds: [] };
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

  fastify.delete('/api/system/images/:id', async (request) => {
    const { id } = request.params as { id: string };
    const { force } = request.query as { force?: string };
    return removeImage(id, force === 'true');
  });
}
