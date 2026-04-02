import { FastifyInstance, FastifyRequest } from 'fastify';
import { sessionQueries, settingQueries } from '../db/index.js';
import { checkForUpdate, performUpdate } from '../services/updater.js';
import { listContainers } from '../services/docker.js';

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
    return {
      autoUpdate: autoUpdate === 'true',
      domainSuffix,
      extraHostname,
    };
  });

  fastify.put('/api/system/settings', async (request) => {
    const body = request.body as { autoUpdate?: boolean; domainSuffix?: string; extraHostname?: string };
    if (body.autoUpdate !== undefined) {
      settingQueries.set('auto_update', body.autoUpdate ? 'true' : 'false');
    }
    if (body.domainSuffix !== undefined) {
      settingQueries.set('caddy_domain_suffix', body.domainSuffix);
    }
    if (body.extraHostname !== undefined) {
      settingQueries.set('caddy_extra_hostname', body.extraHostname);
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
}
