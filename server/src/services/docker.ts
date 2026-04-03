import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { projectQueries } from '../db/index.js';
import { checkImageUpdateWithPolicy } from './registry.js';

const execAsync = promisify(exec);

export interface Container {
  id: string;
  name: string;
  image: string;
  status: string;
  state: 'running' | 'exited' | 'paused' | 'restarting' | 'created' | 'dead';
  project?: string;
  service?: string;
  created: string;
  ports?: string[];
}

export interface ContainerStats {
  containerId: string;
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  memoryPercent: number;
}

export interface ImageInfo {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

async function execCommand(cmd: string): Promise<string> {
  const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 });
  return (stdout || '').trim();
}

function parsePorts(portsStr: string): string[] {
  const seen = new Set<string>();
  // Match host port in: 0.0.0.0:PORT->..., [::]:PORT->..., :::PORT->..., *:PORT->...
  const regex = /(?:0\.0\.0\.0|\[?:+\]?|\*)(?::)(\d+)->/g;
  let match;
  while ((match = regex.exec(portsStr)) !== null) {
    seen.add(match[1]);
  }
  return Array.from(seen);
}

export async function listContainers(): Promise<Container[]> {
  try {
    const output = await execCommand(
      'docker ps -a --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.State}}|{{.Labels}}|{{.CreatedAt}}|{{.Ports}}"'
    );
    
    if (!output) return [];
    
    return output.split('\n').map(line => {
      const [id, name, image, status, state, labels, created, portsStr] = line.split('|');
      const projectLabel = labels?.match(/com\.docker\.compose\.project=([^,]+)/)?.[1];
      const serviceLabel = labels?.match(/com\.docker\.compose\.service=([^,]+)/)?.[1];
      const ports = portsStr ? parsePorts(portsStr) : [];

      return {
        id,
        name,
        image,
        status,
        state: state as Container['state'],
        project: projectLabel,
        service: serviceLabel,
        created,
        ports,
      };
    });
  } catch {
    return [];
  }
}

export async function listProjectContainers(projectPath: string): Promise<Container[]> {
  const containers = await listContainers();
  const projectName = path.basename(path.dirname(projectPath));
  return containers.filter(c => c.project === projectName);
}

export async function getContainerLogs(containerId: string, tail = 100): Promise<string> {
  try {
    return await execCommand(`docker logs ${containerId} --tail ${tail} 2>&1`);
  } catch {
    return '';
  }
}

export async function startContainer(containerId: string): Promise<void> {
  await execCommand(`docker start ${containerId}`);
}

export async function stopContainer(containerId: string): Promise<void> {
  await execCommand(`docker stop ${containerId}`);
}

export async function restartContainer(containerId: string): Promise<void> {
  await execCommand(`docker restart ${containerId}`);
}

export async function deployProject(projectId: number): Promise<{ success: boolean; output: string }> {
  const project = projectQueries.getById(projectId);
  if (!project) {
    return { success: false, output: 'Project not found' };
  }

  const projectDir = path.dirname(project.path);
  const projectName = path.basename(projectDir);
  const command = `docker compose -f "${project.path}" -p "${projectName}" up -d`;

  try {
    const { stdout, stderr } = await execAsync(command, { cwd: projectDir, timeout: 120000 });
    return { success: true, output: stdout || stderr || 'Deploy completed' };
  } catch (error: unknown) {
    const err = error as { message?: string; stdout?: string; stderr?: string; code?: string };
    console.error('Deploy error:', err);
    return { success: false, output: err.stderr || err.stdout || err.message || 'Unknown error' };
  }
}

export async function composeDown(
  projectId: number,
  options: { removeVolumes?: boolean }
): Promise<{ success: boolean; output: string }> {
  const project = projectQueries.getById(projectId);
  if (!project) return { success: false, output: 'Project not found' };

  const projectDir = path.dirname(project.path);
  const projectName = path.basename(projectDir);
  const flags = options.removeVolumes ? ' --volumes' : '';
  const command = `docker compose -f "${project.path}" -p "${projectName}" down${flags}`;

  try {
    const { stdout, stderr } = await execAsync(command, { cwd: projectDir, timeout: 60000 });
    return { success: true, output: stdout || stderr || 'Down completed' };
  } catch (error: unknown) {
    const err = error as { stderr?: string; message?: string };
    return { success: false, output: err.stderr || err.message || 'Unknown error' };
  }
}

export async function updateProjectImages(projectId: number): Promise<{ changed: boolean; output: string }> {
  const project = projectQueries.getById(projectId);
  if (!project) {
    return { changed: false, output: 'Project not found' };
  }

  const projectDir = path.dirname(project.path);
  const projectName = path.basename(projectDir);

  try {
    await execCommand(`docker compose -f "${project.path}" -p "${projectName}" pull`);
    
    const before = await execCommand(`docker images --format "{{.Repository}}:{{.Tag}}|{{.ID}}" | grep -v "<none>"`);
    
    await execCommand(`docker compose -f "${project.path}" -p "${projectName}" up -d --pull always`);
    
    const after = await execCommand(`docker images --format "{{.Repository}}:{{.Tag}}|{{.ID}}" | grep -v "<none>"`);
    
    const changed = before !== after;
    
    try {
      await execCommand('docker image prune -f');
    } catch {}

    return { changed, output: `Update completed. Images ${changed ? 'were' : 'were not'} changed.` };
  } catch (error: unknown) {
    const err = error as { stderr?: string };
    return { changed: false, output: err.stderr || 'Unknown error' };
  }
}

export async function checkProjectImageUpdates(projectId: number): Promise<{ hasUpdates: boolean; services: string[] }> {
  const project = projectQueries.getById(projectId);
  if (!project) return { hasUpdates: false, services: [] };

  const projectDir = path.dirname(project.path);
  const projectName = path.basename(projectDir);
  const policy = project.auto_update_policy ?? 'all';

  // Collect service → image mappings from compose config
  const serviceImages: Array<{ service: string; image: string }> = [];
  try {
    const { stdout } = await execAsync(
      `docker compose -f "${project.path}" -p "${projectName}" config --format json`,
      { cwd: projectDir, timeout: 30000 }
    );
    const config = JSON.parse(stdout) as { services?: Record<string, { image?: string }> };
    for (const [serviceName, svc] of Object.entries(config.services ?? {})) {
      if (svc.image) serviceImages.push({ service: serviceName, image: svc.image });
    }
  } catch (err) {
    console.warn(`[update-check] Could not parse compose config for project ${projectId}: ${err instanceof Error ? err.message : String(err)}`);
    return { hasUpdates: false, services: [] };
  }

  if (serviceImages.length === 0) return { hasUpdates: false, services: [] };

  const servicesWithUpdates: string[] = [];

  await Promise.all(serviceImages.map(async ({ service, image }) => {
    try {
      const result = await checkImageUpdateWithPolicy(image, policy);
      if (result.hasUpdate) servicesWithUpdates.push(service);
    } catch (err) {
      console.warn(`[update-check] Failed for ${image}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }));

  return { hasUpdates: servicesWithUpdates.length > 0, services: servicesWithUpdates };
}

export async function validateComposeFile(filePath: string): Promise<{ valid: boolean; error?: string }> {
  try {
    await fs.access(filePath);
    const content = await fs.readFile(filePath, 'utf-8');
    
    if (!content || !content.includes('services:')) {
      return { valid: false, error: 'No services section found in compose file' };
    }
    
    const { stderr } = await execAsync(`docker compose -f "${filePath}" config --quiet`, { timeout: 30000 });
    if (stderr) {
      const errorMsg = stderr.trim().split('\n').slice(0, 3).join('\n');
      return { valid: false, error: errorMsg };
    }
    return { valid: true };
  } catch (error: unknown) {
    const err = error as { stderr?: string; message?: string };
    const errorMsg = err.stderr?.trim() || err.message || 'Unknown error';
    return { valid: false, error: errorMsg };
  }
}

export async function getImageInfo(imageName: string): Promise<ImageInfo | null> {
  try {
    const output = await execCommand(`docker images ${imageName} --format "{{.ID}}|{{.Repository}}|{{.Tag}}|{{.Size}}|{{.CreatedAt}}"`);
    const [id, repository, tag, size, created] = output.split('|');
    
    if (!id) return null;
    
    return { id, repository, tag, size, created };
  } catch {
    return null;
  }
}

export function deployProjectStream(
  projectId: number,
  onLine: (line: string) => void,
  onDone: (success: boolean) => void,
): () => void {
  const project = projectQueries.getById(projectId);
  if (!project) {
    onLine('Error: Project not found');
    onDone(false);
    return () => {};
  }

  const projectDir = path.dirname(project.path);
  const projectName = path.basename(projectDir);

  const child = spawn('docker', ['compose', '-f', project.path, '-p', projectName, 'up', '-d'], {
    cwd: projectDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const handleData = (data: Buffer) => {
    const lines = String(data).split('\n');
    for (const line of lines) {
      if (line.length > 0) onLine(line);
    }
  };

  child.stdout?.on('data', handleData);
  child.stderr?.on('data', handleData);

  child.on('close', (code) => {
    onDone(code === 0);
  });

  return () => {
    try { child.kill('SIGTERM'); } catch {}
  };
}

export async function streamLogs(containerId: string, callback: (line: string) => void): Promise<() => void> {
  const proc = spawn('docker', ['logs', '-f', '--tail', '100', containerId], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stdout.on('data', (data: Buffer) => {
    callback(data.toString());
  });

  proc.stderr.on('data', (data: Buffer) => {
    callback(data.toString());
  });

  return () => {
    proc.kill();
  };
}
