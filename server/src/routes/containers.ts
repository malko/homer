import { FastifyInstance, FastifyRequest } from 'fastify';
import { listContainers, getContainerLogs, startContainer, stopContainer, restartContainer } from '../services/docker.js';
import { sessionQueries } from '../db/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { username: string };
  }
}

export async function containerRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', async (request: FastifyRequest) => {
    const token = request.headers.authorization?.replace('Bearer ', '');
      const session = token ? sessionQueries.getByToken(token) : null;
    if (!session) {
      throw { statusCode: 401, message: 'Unauthorized' };
    }
  });

  fastify.get('/api/containers', async () => {
    return listContainers();
  });

  fastify.get('/api/containers/:id/logs', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tail } = request.query as { tail?: string };
    
    const logs = await getContainerLogs(id, tail ? parseInt(tail) : 100);
    return { logs };
  });

  fastify.post('/api/containers/:id/start', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    try {
      await startContainer(id);
      fastify.broadcast({ type: 'containers_updated' });
      return { success: true };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return reply.status(500).send({ error: err.message || 'Failed to start container' });
    }
  });

  fastify.post('/api/containers/:id/stop', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    try {
      await stopContainer(id);
      fastify.broadcast({ type: 'containers_updated' });
      return { success: true };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return reply.status(500).send({ error: err.message || 'Failed to stop container' });
    }
  });

  fastify.post('/api/containers/:id/restart', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    try {
      await restartContainer(id);
      fastify.broadcast({ type: 'containers_updated' });
      return { success: true };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return reply.status(500).send({ error: err.message || 'Failed to restart container' });
    }
  });
}
