import { FastifyInstance, FastifyRequest } from 'fastify';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
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
import { groupComposeProjects, findRelativePathRefs, getOwnComposeInfo } from '../services/compose-discovery.js';
import { getComposeProjectName, getMountHint } from '../services/compose-project-name.js';
import { buildMountGuide } from '../services/mount-override.js';

const execFileAsync = promisify(execFile);

const externalImportSchema = z.object({
  // Discovered mode: a running stack picked from /api/import/compose-projects.
  name: z.string().min(1).optional(),
  configFile: z.string().min(1).optional(),
  // Manual mode: an absolute compose file path typed by the user.
  manualPath: z.string().min(1).optional(),
}).refine(b => Boolean(b.manualPath) !== Boolean(b.name && b.configFile), {
  message: 'Provide either manualPath, or name + configFile',
});

function relativePathWarnings(composeContent: string): string[] {
  const refs = findRelativePathRefs(composeContent);
  if (refs.length === 0) return [];
  return [
    'This compose file references relative paths (' + refs.join(' | ') + '). ' +
    'Relative paths resolve against the compose project directory and only keep working through Homer because of the identical-path mount — prefer absolute paths in your compose file to avoid ambiguity.',
  ];
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: { username: string };
  }
}

export async function importRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', async (request: FastifyRequest) => {
    if (request.isPeerRequest) return;
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

  fastify.get('/api/import/existing-projects', async () => {
    const existingProjects = projectQueries.getAll();
    const managedPaths = new Set(existingProjects.map(p => p.path));

    const dirents = await fs.readdir(DB_CONFIG.projectsDir, { withFileTypes: true });
    const foundProjects: Array<{ name: string; path: string; composeExists: boolean }> = [];

    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue;

      const projectPath = path.join(DB_CONFIG.projectsDir, dirent.name);
      const composePath = path.join(projectPath, 'docker-compose.yml');

      try {
        const stat = await fs.stat(composePath);
        if (stat.isFile()) {
          if (!managedPaths.has(composePath)) {
            foundProjects.push({
              name: dirent.name,
              path: composePath,
              composeExists: true,
            });
          }
        }
      } catch {
      }
    }

    return { projects: foundProjects };
  });

  fastify.post('/api/import/existing', async (request, reply) => {
    const { projectPaths } = request.body as {
      projectPaths?: string[];
    };

    if (!projectPaths || !Array.isArray(projectPaths) || projectPaths.length === 0) {
      return reply.status(400).send({ error: 'At least one project path is required' });
    }

    const existingProjects = projectQueries.getAll();
    const managedPaths = new Set(existingProjects.map(p => p.path));

    const results: Array<{ name: string; path: string; success: boolean; error?: string }> = [];

    for (const composePath of projectPaths) {
      try {
        if (managedPaths.has(composePath)) {
          results.push({ name: path.basename(path.dirname(composePath)), path: composePath, success: false, error: 'Already managed' });
          continue;
        }

        const projectName = path.basename(path.dirname(composePath));
        const envPath = path.join(path.dirname(composePath), '.env');

        let envPathValue: string | null = null;
        try {
          await fs.access(envPath);
          envPathValue = envPath;
        } catch {}

        const result = projectQueries.create(projectName, composePath, envPathValue);
        const newProject = projectQueries.getById(Number(result.lastInsertRowid));

        if (!newProject) {
          results.push({ name: projectName, path: composePath, success: false, error: 'Failed to create project' });
          continue;
        }

        results.push({ name: newProject.name, path: newProject.path, success: true });
      } catch (error: unknown) {
        const err = error as { message?: string };
        results.push({ name: path.basename(path.dirname(composePath)), path: composePath, success: false, error: err.message || 'Unknown error' });
      }
    }

    return { results };
  });

  // Running compose stacks (from container labels) not yet managed by Homer.
  fastify.get('/api/import/compose-projects', async () => {
    let labelSets: Array<Record<string, string> | null> = [];
    try {
      const { stdout: idsOut } = await execFileAsync('docker', ['ps', '-a', '--format', '{{.ID}}']);
      const ids = idsOut.split('\n').filter(Boolean);
      if (ids.length > 0) {
        // JSON labels, not {{.Labels}}: config_files values may contain commas.
        const { stdout } = await execFileAsync('docker', ['inspect', '--format', '{{json .Config.Labels}}', ...ids]);
        labelSets = stdout.split('\n').filter(Boolean).map(line => {
          try { return JSON.parse(line) as Record<string, string>; } catch { return null; }
        });
      }
    } catch (err) {
      fastify.log.error('compose-projects discovery failed: ' + (err instanceof Error ? err.message : String(err)));
      return { projects: [] };
    }

    const managed = projectQueries.getAll();
    const managedNames = new Set(managed.map(p => getComposeProjectName(p)));
    const managedPaths = new Set(managed.map(p => p.path));
    // Homer must not offer to adopt the stack it is running in.
    const ownStack = await getOwnComposeInfo();

    const projects = [];
    const inaccessibleDirs: string[] = [];
    for (const discovered of groupComposeProjects(labelSets)) {
      if (discovered.name === ownStack?.project) continue;
      if (managedNames.has(discovered.name) || discovered.configFiles.some(f => managedPaths.has(f))) continue;
      let accessible = false;
      try {
        await fs.access(discovered.configFiles[0]);
        accessible = true;
      } catch {
        inaccessibleDirs.push(path.dirname(discovered.configFiles[0]));
      }
      projects.push({ ...discovered, accessible });
    }

    // Also cover already-adopted external projects still waiting for a mount,
    // so the single generated override fixes everything at once.
    for (const p of managed) {
      if (p.external) {
        try { await fs.access(p.path); } catch { inaccessibleDirs.push(path.dirname(p.path)); }
      }
    }

    const mountGuide = inaccessibleDirs.length > 0 ? buildMountGuide(inaccessibleDirs, ownStack) : undefined;
    return { projects, mountGuide };
  });

  // Adopt an external compose project (outside Homer's data dir).
  fastify.post('/api/import/external', async (request, reply) => {
    const parsed = externalImportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Provide either manualPath, or name + configFile' });
    }
    const body = parsed.data;
    const composePath = (body.manualPath ?? body.configFile) as string;
    const warnings: string[] = [];

    if (!path.isAbsolute(composePath)) {
      return reply.status(400).send({ error: 'Compose file path must be absolute' });
    }
    if (composePath.startsWith(DB_CONFIG.projectsDir + path.sep)) {
      return reply.status(400).send({ error: 'This compose file lives in Homer\'s projects directory — use the "existing projects" import instead' });
    }

    const ownStack = await getOwnComposeInfo();
    if (ownStack && (body.name === ownStack.project || ownStack.configFiles.includes(composePath))) {
      return reply.status(400).send({ error: 'This is the stack Homer itself runs in — it cannot adopt itself' });
    }

    const managed = projectQueries.getAll();
    if (managed.some(p => p.path === composePath)) {
      return reply.status(400).send({ error: 'Project already managed' });
    }
    if (body.name && managed.some(p => getComposeProjectName(p) === body.name)) {
      return reply.status(400).send({ error: `A managed project already uses the compose project name "${body.name}"` });
    }

    let accessible = true;
    try {
      await fs.access(composePath);
    } catch {
      accessible = false;
    }

    if (body.manualPath && !accessible) {
      return reply.status(400).send({ error: getMountHint(composePath) });
    }

    let envPathValue: string | null = null;
    if (accessible) {
      const validation = await validateComposeFile(composePath);
      if (!validation.valid) {
        if (body.manualPath) {
          return reply.status(400).send({ error: `Invalid compose file: ${validation.error}` });
        }
        // The stack is already running: adopt it anyway, but surface the issue.
        warnings.push(`Compose file did not validate: ${validation.error}`);
      }

      const envPath = path.join(path.dirname(composePath), '.env');
      try {
        await fs.access(envPath);
        envPathValue = envPath;
      } catch {}

      try {
        warnings.push(...relativePathWarnings(await fs.readFile(composePath, 'utf-8')));
      } catch {}
    } else {
      warnings.push(getMountHint(composePath));
    }

    const displayName = body.name ?? path.basename(path.dirname(composePath));
    const composeProject = body.name ?? null;
    const result = projectQueries.create(displayName, composePath, envPathValue, 0, 'all', 1, composeProject);
    const newProject = projectQueries.getById(Number(result.lastInsertRowid));

    if (!newProject) {
      return reply.status(500).send({ error: 'Failed to create project' });
    }

    return { success: true, project: newProject, warnings };
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
