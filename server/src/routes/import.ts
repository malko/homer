import { FastifyInstance, FastifyRequest } from 'fastify';
import fs from 'fs/promises';
import path from 'path';
import { 
  parseDockerRun, 
  serviceToCompose, 
  generateEnvFromParsedService,
  getStandaloneContainers, 
  containersToCompose,
  getContainerDecisions,
  type StandaloneContainer,
  type ContainerDecision,
  type MigrationResult 
} from '../services/parser.js';
import { projectQueries, sessionQueries, DB_CONFIG } from '../db/index.js';
import { validateComposeFile } from '../services/docker.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { username: string };
  }
}

export async function importRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', async (request: FastifyRequest) => {
    const token = request.headers.authorization?.replace('Bearer ', '');
    const session = token ? sessionQueries.getByToken(token) : null;
    if (!session) {
      throw { statusCode: 401, message: 'Unauthorized' };
    }
  });

  fastify.post('/api/import/parse', async (request, reply) => {
    const { command } = request.body as { command?: string };

    if (!command || typeof command !== 'string') {
      return reply.status(400).send({ error: 'docker run command is required' });
    }

    const result = parseDockerRun(command);

    if ('error' in result) {
      return reply.status(400).send({ error: result.error });
    }

    const compose = serviceToCompose(result.service);
    const envContent = generateEnvFromParsedService(result.service);

    return {
      service: result.service,
      compose,
      envContent,
      warnings: result.warnings,
    };
  });

  fastify.get('/api/import/standalone', async () => {
    const containers = await getStandaloneContainers();
    return { containers };
  });

  fastify.post('/api/import/containers', async (request, reply) => {
    const { containerIds, decisions } = request.body as {
      containerIds?: string[];
      decisions?: Record<string, boolean>;
    };

    if (!containerIds || !Array.isArray(containerIds) || containerIds.length === 0) {
      return reply.status(400).send({ error: 'At least one container ID is required' });
    }

    const allContainers = await getStandaloneContainers();
    const selectedContainers = allContainers.filter(c => containerIds.includes(c.id));

    if (selectedContainers.length === 0) {
      return reply.status(400).send({ error: 'No valid containers found' });
    }

    const result = containersToCompose(selectedContainers, decisions || {});

    return {
      containers: selectedContainers,
      ...result,
    };
  });

  fastify.post('/api/import/decisions', async (request, reply) => {
    const { containerIds } = request.body as {
      containerIds?: string[];
    };

    if (!containerIds || !Array.isArray(containerIds) || containerIds.length === 0) {
      return reply.status(400).send({ error: 'At least one container ID is required' });
    }

    const allContainers = await getStandaloneContainers();
    const selectedContainers = allContainers.filter(c => containerIds.includes(c.id));

    if (selectedContainers.length === 0) {
      return reply.status(400).send({ error: 'No valid containers found' });
    }

    const allDecisions: ContainerDecision[] = [];
    for (const container of selectedContainers) {
      const decisions = getContainerDecisions(container);
      allDecisions.push(...decisions);
    }

    return { decisions: allDecisions };
  });

  fastify.post('/api/import/save', async (request, reply) => {
    const { compose, envContent, projectName } = request.body as {
      compose?: string;
      envContent?: string;
      projectName?: string;
    };

    if (!compose || typeof compose !== 'string') {
      return reply.status(400).send({ error: 'Compose content is required' });
    }

    if (!projectName || typeof projectName !== 'string') {
      return reply.status(400).send({ error: 'Project name is required' });
    }

    const safeName = projectName
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project';
    const projectDir = path.join(DB_CONFIG.projectsDir, safeName);
    const composeFileName = path.join(projectDir, 'docker-compose.yml');
    const envFileName = path.join(projectDir, '.env');

    try {
      const dir = path.dirname(composeFileName);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(composeFileName, compose, 'utf-8');

      if (envContent) {
        await fs.writeFile(envFileName, envContent, 'utf-8');
      }

      const validation = await validateComposeFile(composeFileName);
      if (!validation.valid) {
        await fs.unlink(composeFileName).catch(() => {});
        if (envContent) {
          await fs.unlink(envFileName).catch(() => {});
        }
        return reply.status(400).send({ error: `Invalid compose file: ${validation.error}` });
      }

      const existing = projectQueries.getAll();
      if (existing.some((p) => p.path === composeFileName)) {
        return reply.status(400).send({ error: 'Project already managed' });
      }

      const result = projectQueries.create(
        safeName,
        composeFileName,
        envFileName
      );

      const newProject = projectQueries.getById(Number(result.lastInsertRowid));

      return { 
        success: true, 
        project: newProject, 
        composePath: composeFileName,
        envPath: envContent ? envFileName : null,
      };
    } catch (error: unknown) {
      const err = error as { message?: string; code?: string };
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        return reply.status(403).send({ error: 'Permission denied writing to target path' });
      }
      return reply.status(500).send({ error: err.message || 'Failed to save' });
    }
  });
}
