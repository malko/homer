import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { projectQueries, settingQueries, DB_CONFIG } from '../db/index.js';
import { requireSession } from '../middleware/require-session.js';
import { addToNetworkSchema } from './request-schemas.js';
import { validateComposeFile, deployProject, updateProjectImages, listContainers, composeDown, checkProjectImageUpdates, isProjectFileAccessible } from '../services/docker.js';
import { getComposeProjectName, getMountHint } from '../services/compose-project-name.js';
import { getOwnComposeInfo } from '../services/compose-discovery.js';
import { buildMountGuide, type MountGuide } from '../services/mount-override.js';
import { addProjectToHomerNetwork, ensureHomerNetworkExists, getProjectServices } from '../services/compose.js';
import path from 'path';
import fs from 'fs/promises';
import { FileWatcher } from '../services/watcher.js';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getProjectPath(projectName: string): { composePath: string; envPath: string; projectDir: string } {
  const slug = slugify(projectName);
  const projectDir = path.join(DB_CONFIG.projectsDir, slug);
  return {
    composePath: path.join(projectDir, 'docker-compose.yml'),
    envPath: path.join(projectDir, '.env'),
    projectDir,
  };
}

const AUTO_UPDATE_POLICIES = ['disabled', 'all', 'semver_minor', 'semver_patch'] as const;

const projectSchema = z.object({
  name: z.string().min(1).max(100),
  envPath: z.string().optional().nullable(),
  autoUpdate: z.boolean().optional(),
  autoUpdatePolicy: z.enum(AUTO_UPDATE_POLICIES).optional(),
  watchEnabled: z.boolean().optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  envPath: z.string().optional().nullable(),
  url: z.string().url().optional().nullable().or(z.literal('')),
  icon: z.string().max(500000).optional().nullable(),
  autoUpdate: z.boolean().optional(),
  autoUpdatePolicy: z.enum(AUTO_UPDATE_POLICIES).optional(),
  watchEnabled: z.boolean().optional(),
});

declare module 'fastify' {
  interface FastifyInstance {
    watcher: FileWatcher;
  }
  interface FastifyRequest {
    user?: { username: string };
  }
}

// One guide covering the dirs of every inaccessible external project, so a
// single override paste fixes them all. Null when everything is accessible.
async function buildSharedMountGuide(projects: { name: string; path: string; external: number }[]): Promise<MountGuide | null> {
  const entries: { dir: string; project: string }[] = [];
  for (const project of projects) {
    if (project.external && !(await isProjectFileAccessible(project))) {
      entries.push({ dir: path.dirname(project.path), project: project.name });
    }
  }
  if (entries.length === 0) return null;
  return buildMountGuide(entries, await getOwnComposeInfo());
}

export async function projectRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireSession);

  fastify.get('/api/projects', async () => {
    const projects = projectQueries.getAll();
    const containers = await listContainers();
    const mountGuide = await buildSharedMountGuide(projects);

    return Promise.all(projects.map(async (project) => {
      const projectName = getComposeProjectName(project);
      const projectContainers = containers.filter(c => c.project === projectName);

      let updateAvailable = false;
      try {
        const cached = settingQueries.get(`image_updates_${project.id}`);
        if (cached) {
          const data = JSON.parse(cached);
          updateAvailable = !!data.hasUpdates;
        }
      } catch {}

      const fileAccessible = await isProjectFileAccessible(project);
      return {
        ...project,
        auto_update: Boolean(project.auto_update),
        watch_enabled: Boolean(project.watch_enabled),
        external: Boolean(project.external),
        fileAccessible,
        mount_guide: fileAccessible ? undefined : mountGuide ?? undefined,
        update_available: updateAvailable,
        containers: projectContainers,
        allRunning: projectContainers.length > 0 && projectContainers.every(c => c.state === 'running'),
        anyRunning: projectContainers.some(c => c.state === 'running'),
      };
    }));
  });

  fastify.get('/api/projects/:id', async (request, reply) => {
    const id = parseInt((request.params as { id: string }).id);
    const project = projectQueries.getById(id);
    
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }
    
    const containers = await listContainers();
    const projectName = getComposeProjectName(project);
    const projectContainers = containers.filter(c => c.project === projectName);

    const fileAccessible = await isProjectFileAccessible(project);
    const mountGuide = fileAccessible ? null : await buildSharedMountGuide(projectQueries.getAll());
    return {
      ...project,
      auto_update: Boolean(project.auto_update),
      watch_enabled: Boolean(project.watch_enabled),
      external: Boolean(project.external),
      fileAccessible,
      mount_guide: mountGuide ?? undefined,
      containers: projectContainers,
    };
  });

  fastify.post('/api/projects', async (request, reply) => {
    const body = projectSchema.parse(request.body);
    
    const { composePath, envPath, projectDir } = getProjectPath(body.name);
    
    const existing = projectQueries.getAll();
    if (existing.some((p) => p.name.toLowerCase() === body.name.toLowerCase())) {
      return reply.status(400).send({ error: 'A project with this name already exists' });
    }

    try {
      await fs.mkdir(projectDir, { recursive: true });
      
      const defaultCompose = `services:
  # Add your services here
`;
      await fs.writeFile(composePath, defaultCompose, 'utf-8');

      const result = projectQueries.create(
        body.name,
        composePath,
        envPath,
        body.autoUpdate ? 1 : 0,
        body.autoUpdatePolicy ?? 'all'
      );
      
      const newProject = projectQueries.getById(Number(result.lastInsertRowid));
      
      if (body.watchEnabled && newProject) {
        fastify.watcher?.addProject(newProject);
      }
      
      return newProject;
    } catch (error: unknown) {
      const err = error as { message?: string; code?: string };
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        return reply.status(403).send({ error: 'Permission denied creating project directory' });
      }
      return reply.status(500).send({ error: err.message || 'Failed to create project' });
    }
  });

  fastify.put('/api/projects/:id', async (request, reply) => {
    const id = parseInt((request.params as { id: string }).id);
    const body = updateProjectSchema.parse(request.body);
    const project = projectQueries.getById(id);
    
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }
    
    const newName = body.name || project.name;
    // External projects keep their on-disk path: it is not derived from the name.
    const newPath = project.external ? project.path : getProjectPath(newName).composePath;

    if (body.watchEnabled && !(await isProjectFileAccessible(project))) {
      return reply.status(400).send({ error: getMountHint(project.path) });
    }

    const newUrl = body.url !== undefined ? (body.url || null) : project.url;
    const newIcon = body.icon !== undefined ? (body.icon || null) : project.icon;
    projectQueries.update(
      newName,
      newPath,
      body.envPath !== undefined ? body.envPath : project.env_path,
      newUrl,
      newIcon,
      body.autoUpdate !== undefined ? (body.autoUpdate ? 1 : 0) : project.auto_update,
      body.autoUpdatePolicy ?? project.auto_update_policy ?? 'all',
      body.watchEnabled !== undefined ? (body.watchEnabled ? 1 : 0) : project.watch_enabled,
      id
    );
    
    const updated = projectQueries.getById(id);
    
    if (updated) {
      fastify.watcher?.removeProject(id);
      if (updated.watch_enabled) {
        fastify.watcher?.addProject(updated);
      }
    }
    
    return updated;
  });

  fastify.delete('/api/projects/:id', async (request, reply) => {
    const id = parseInt((request.params as { id: string }).id);
    const project = projectQueries.getById(id);

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const q = request.query as { composeDown?: string; removeVolumes?: string; deleteFiles?: string };
    const warnings: string[] = [];

    fastify.watcher?.removeProject(id);

    if (q.composeDown === '1') {
      const result = await composeDown(id, { removeVolumes: q.removeVolumes === '1' });
      if (!result.success) {
        fastify.log.error('compose down failed: ' + result.output);
        warnings.push('Compose down: ' + result.output);
      }
    }

    projectQueries.delete(id);

    // Never touch files outside Homer's data dir: external projects are only
    // removed from Homer, their files stay untouched on the host.
    if (q.deleteFiles === '1' && !project.external) {
      try {
        const projectDir = path.dirname(project.path);
        await fs.rm(projectDir, { recursive: true, force: true });
      } catch (err: unknown) {
        const e = err as { message?: string };
        warnings.push('File deletion: ' + (e.message || 'Unknown error'));
      }
    }

    return { success: true, output: warnings.length ? warnings.join('; ') : undefined };
  });

  fastify.post('/api/projects/:id/deploy', async (request, reply) => {
    const id = parseInt((request.params as { id: string }).id);
    
    if (isNaN(id)) {
      return reply.status(400).send({ error: 'Invalid project ID' });
    }
    
    try {
      const result = await deployProject(id);
      
      if (!result.success) {
        return reply.status(500).send({ error: result.output });
      }
      
      fastify.broadcast({ type: 'containers_updated' });
      
      return { success: true, output: result.output };
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error('Deploy error:', err);
      return reply.status(500).send({ error: err.message || 'Deploy failed' });
    }
  });

  fastify.post('/api/projects/:id/update', async (request, reply) => {
    const id = parseInt((request.params as { id: string }).id);
    
    if (isNaN(id)) {
      return reply.status(400).send({ error: 'Invalid project ID' });
    }
    
    try {
      const result = await updateProjectImages(id);
      
      fastify.broadcast({ type: 'containers_updated' });
      fastify.broadcast({ 
        type: 'project_updated', 
        projectId: id, 
        changed: result.changed 
      });
      
      return { success: true, changed: result.changed, output: result.output };
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error('Update error:', err);
      return reply.status(500).send({ error: err.message || 'Update failed' });
    }
  });

  fastify.get('/api/projects/:id/files', async (request, reply) => {
    const id = parseInt((request.params as { id: string }).id);
    const project = projectQueries.getById(id);
    
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }
    
    try {
      const composeContent = await fs.readFile(project.path, 'utf-8');
      let envContent = '';
      
      if (project.env_path) {
        try {
          envContent = await fs.readFile(project.env_path, 'utf-8');
        } catch {
          envContent = '';
        }
      }
      
      return {
        composePath: project.path,
        composeContent,
        envPath: project.env_path,
        envContent,
      };
    } catch (error: unknown) {
      const err = error as { message?: string; code?: string };
      if (err.code === 'ENOENT') {
        if (project.external) {
          return reply.status(404).send({ error: getMountHint(project.path) });
        }
        return reply.status(404).send({ error: 'File not found' });
      }
      return reply.status(500).send({ error: err.message || 'Failed to read files' });
    }
  });

  const saveFilesSchema = z.object({
    composeContent: z.string(),
    envContent: z.string().optional(),
  });

  fastify.put('/api/projects/:id/files', async (request, reply) => {
    const id = parseInt((request.params as { id: string }).id);
    const body = saveFilesSchema.parse(request.body);
    const project = projectQueries.getById(id);
    
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    if (!(await isProjectFileAccessible(project))) {
      return reply.status(409).send({ error: getMountHint(project.path) });
    }

    const projectDir = path.dirname(project.path);
    let envPath = project.env_path;
    
    try {
      await fs.writeFile(project.path, body.composeContent, 'utf-8');
      
      if (body.envContent !== undefined) {
        if (body.envContent.trim()) {
          if (!envPath) {
            envPath = path.join(projectDir, '.env');
            projectQueries.update(project.name, project.path, envPath, project.url, project.icon, project.auto_update, project.auto_update_policy ?? 'all', project.watch_enabled, id);
          }
          await fs.writeFile(envPath, body.envContent, 'utf-8');
        } else if (envPath) {
          await fs.unlink(envPath).catch(() => {});
          projectQueries.update(project.name, project.path, null, project.url, project.icon, project.auto_update, project.auto_update_policy ?? 'all', project.watch_enabled, id);
        }
      }
      
      const validation = await validateComposeFile(project.path);
      if (!validation.valid) {
        return reply.status(400).send({ error: `Invalid compose file: ${validation.error}` });
      }
      
      fastify.broadcast({ type: 'containers_updated' });
      
      return { success: true };
    } catch (error: unknown) {
      const err = error as { message?: string; code?: string };
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        return reply.status(403).send({ error: 'Permission denied' });
      }
      return reply.status(500).send({ error: err.message || 'Failed to save files' });
    }
  });

  fastify.post('/api/projects/:id/validate', async (request, reply) => {
    const id = parseInt((request.params as { id: string }).id);
    const project = projectQueries.getById(id);
    
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    if (!(await isProjectFileAccessible(project))) {
      return { valid: false, error: getMountHint(project.path) };
    }

    const validation = await validateComposeFile(project.path);
    
    if (!validation.valid) {
      return { valid: false, error: validation.error };
    }
    
    return { valid: true };
  });

  // Check for image updates (cached, max once per 6 hours unless force=1)
  fastify.get('/api/projects/:id/update-check', async (request, reply) => {
    const id = parseInt((request.params as { id: string }).id);
    const { force } = request.query as { force?: string };
    const project = projectQueries.getById(id);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const cacheKey = `image_updates_${id}`;
    if (force !== '1') {
      const cached = settingQueries.get(cacheKey);
      if (cached) {
        try {
          const data = JSON.parse(cached);
          const sixHours = 6 * 60 * 60 * 1000;
          if (Date.now() - data.checkedAt < sixHours) {
            return { hasUpdates: data.hasUpdates, services: data.services };
          }
        } catch {}
      }
    }

    const result = await checkProjectImageUpdates(id);
    settingQueries.set(cacheKey, JSON.stringify({ ...result, checkedAt: Date.now() }));

    if (result.hasUpdates) {
      fastify.broadcast?.({ type: 'project_update_available', projectId: id, hasUpdates: true });
    }

    return result;
  });

  fastify.post('/api/projects/:id/add-to-network', async (request, reply) => {
    const id = parseInt((request.params as { id: string }).id);
    const parsed = addToNetworkSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }
    const { services } = parsed.data;
    const project = projectQueries.getById(id);

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    if (!(await isProjectFileAccessible(project))) {
      return reply.status(409).send({ error: getMountHint(project.path) });
    }

    const networkExists = await ensureHomerNetworkExists();
    if (!networkExists) {
      return reply.status(500).send({ error: 'Failed to create homer-services network' });
    }

    const result = await addProjectToHomerNetwork(project.path, services);
    
    if (result.success) {
      fastify.broadcast({ type: 'containers_updated' });
    }
    
    return result;
  });

  fastify.get('/api/projects/:id/services', async (request, reply) => {
    const id = parseInt((request.params as { id: string }).id);
    const project = projectQueries.getById(id);
    
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    if (!(await isProjectFileAccessible(project))) {
      return reply.status(409).send({ error: getMountHint(project.path) });
    }

    const services = await getProjectServices(project.path);
    return services;
  });
}
