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
  hasUpdate?: boolean;
}

export interface ContainerStats {
  containerId: string;
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  memoryPercent: number;
}

export interface SystemStats {
  totalContainers: number;
  runningContainers: number;
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  memoryPercent: number;
  systemCpuPercent: number;
  systemMemoryUsage: number;
  systemMemoryTotal: number;
  systemMemoryPercent: number;
}

export interface VolumeInfo {
  name: string;
  driver: string;
  mountpoint: string;
  scope: string;
  created: string;
  project?: string;
  type?: 'docker' | 'compose';
}

export interface NetworkInfo {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  created: string;
  containers?: string[];
  used?: boolean;
}

export interface ImageInfo {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
  used?: boolean;
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

export async function getSystemStats(): Promise<SystemStats> {
  try {
    const containers = await listContainers();
    const runningCount = containers.filter(c => c.state === 'running').length;

    const statsOutput = await execCommand(
      "docker stats --no-stream --format '{{.ID}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}'"
    );

    let totalCpu = 0;
    let totalMemUsage = 0;
    let totalMemLimit = 0;

    if (statsOutput) {
      const lines = statsOutput.split('\n').filter(Boolean);
      for (const line of lines) {
        const [id, cpuStr, memStr, memPercStr] = line.split('|');
        if (!id) continue;

        const cpu = parseFloat(cpuStr.replace('%', '')) || 0;
        totalCpu += cpu;

        const memMatch = memStr.match(/([\d.]+)([KMG]i?)/);
        if (memMatch) {
          const value = parseFloat(memMatch[1]);
          const unit = memMatch[2];
          const multiplier = unit.startsWith('G') ? 1024 * 1024 * 1024 : unit.startsWith('M') ? 1024 * 1024 : 1024;
          totalMemUsage += value * multiplier;
        }

        const memLimitMatch = memStr.match(/\/([\d.]+)([KMG]i?)/);
        if (memLimitMatch) {
          const value = parseFloat(memLimitMatch[1]);
          const unit = memLimitMatch[2];
          const multiplier = unit.startsWith('G') ? 1024 * 1024 * 1024 : unit.startsWith('M') ? 1024 * 1024 : 1024;
          totalMemLimit += value * multiplier;
        }
      }
    }

    let systemMemoryTotal = 0;
    let systemMemoryAvailable = 0;
    try {
      const meminfo = await execCommand("cat /proc/meminfo");
      const totalMatch = meminfo.match(/MemTotal:\s+(\d+)/);
      const availMatch = meminfo.match(/MemAvailable:\s+(\d+)/);
      if (totalMatch) systemMemoryTotal = parseInt(totalMatch[1]) * 1024;
      if (availMatch) systemMemoryAvailable = parseInt(availMatch[1]) * 1024;
    } catch {}

    let systemCpuPercent = 0;
    try {
      const stat1 = await execCommand("cat /proc/stat | grep '^cpu '");
      const parts1 = stat1.match(/cpu\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/);
      await new Promise(resolve => setTimeout(resolve, 500));
      const stat2 = await execCommand("cat /proc/stat | grep '^cpu '");
      const parts2 = stat2.match(/cpu\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/);
      
      if (parts1 && parts2) {
        const idle1 = parseInt(parts1[4]);
        const total1 = parseInt(parts1[1]) + parseInt(parts1[2]) + parseInt(parts1[3]) + parseInt(parts1[4]);
        const idle2 = parseInt(parts2[4]);
        const total2 = parseInt(parts2[1]) + parseInt(parts2[2]) + parseInt(parts2[3]) + parseInt(parts2[4]);
        
        const idleDiff = idle2 - idle1;
        const totalDiff = total2 - total1;
        if (totalDiff > 0) {
          systemCpuPercent = ((totalDiff - idleDiff) / totalDiff) * 100;
        }
      }
    } catch {}

    const effectiveMemLimit = totalMemLimit > 0 ? totalMemLimit : systemMemoryTotal;
    const memoryPercent = effectiveMemLimit > 0 ? (totalMemUsage / effectiveMemLimit) * 100 : 0;
    const systemMemoryUsage = systemMemoryTotal - systemMemoryAvailable;
    const systemMemoryPercent = systemMemoryTotal > 0 ? (systemMemoryUsage / systemMemoryTotal) * 100 : 0;

    return {
      totalContainers: containers.length,
      runningContainers: runningCount,
      cpuPercent: totalCpu,
      memoryUsage: totalMemUsage,
      memoryLimit: effectiveMemLimit,
      memoryPercent,
      systemCpuPercent,
      systemMemoryUsage,
      systemMemoryTotal,
      systemMemoryPercent,
    };
  } catch {
    return {
      totalContainers: 0,
      runningContainers: 0,
      cpuPercent: 0,
      memoryUsage: 0,
      memoryLimit: 0,
      memoryPercent: 0,
      systemCpuPercent: 0,
      systemMemoryUsage: 0,
      systemMemoryTotal: 0,
      systemMemoryPercent: 0,
    };
  }
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

export async function removeContainer(containerId: string): Promise<{ success: boolean; output: string }> {
  try {
    await execCommand(`docker rm -f ${containerId}`);
    return { success: true, output: 'Container supprimé' };
  } catch (error: unknown) {
    const err = error as { stderr?: string; message?: string };
    return { success: false, output: err.stderr || err.message || 'Unknown error' };
  }
}

export async function updateContainerImage(containerId: string): Promise<{ success: boolean; output: string }> {
  try {
    const infoOutput = await execCommand(`docker inspect ${containerId} --format "{{.Config.Image}}"`);
    if (!infoOutput) {
      return { success: false, output: 'Image du container non trouvée' };
    }
    
    const imageName = infoOutput.trim();
    await execCommand(`docker pull ${imageName}`);
    await execCommand(`docker stop ${containerId}`);
    await execCommand(`docker rm -f ${containerId}`);
    
    const containerName = (await execCommand(`docker inspect ${containerId} --format "{{.Name}}"`).catch(() => '')).replace(/^\//, '');
    const projectLabel = await execCommand(`docker inspect ${containerId} --format '{{index .Config.Labels "com.docker.compose.project"}}'`).catch(() => '');
    const serviceLabel = await execCommand(`docker inspect ${containerId} --format '{{index .Config.Labels "com.docker.compose.service"}}'`).catch(() => '');

    let runCmd = 'docker run -d';
    if (containerName) runCmd += ' --name ' + containerName;
    if (projectLabel) runCmd += ' --label com.docker.compose.project=' + projectLabel;
    if (serviceLabel) runCmd += ' --label com.docker.compose.service=' + serviceLabel;
    runCmd += ' ' + imageName;

    await execCommand(runCmd);
    
    return { success: true, output: `Container mis à jour avec l'image ${imageName}` };
  } catch (error: unknown) {
    const err = error as { stderr?: string; message?: string };
    return { success: false, output: err.stderr || err.message || 'Unknown error' };
  }
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

export async function checkContainerUpdate(containerId: string, image: string): Promise<{ hasUpdate: boolean }> {
  if (!image) return { hasUpdate: false };
  try {
    const result = await checkImageUpdateWithPolicy(image, 'all');
    return { hasUpdate: result.hasUpdate };
  } catch {
    return { hasUpdate: false };
  }
}

export async function checkAllContainerUpdates(): Promise<Record<string, { hasUpdate: boolean; image: string }>> {
  const containers = await listContainers();
  const results: Record<string, { hasUpdate: boolean; image: string }> = {};

  await Promise.all(containers.map(async (container) => {
    if (!container.image || !container.id) return;
    try {
      const result = await checkImageUpdateWithPolicy(container.image, 'all');
      results[container.id] = { hasUpdate: result.hasUpdate, image: container.image };
    } catch {
      results[container.id] = { hasUpdate: false, image: container.image };
    }
  }));

  return results;
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

export async function listVolumes(): Promise<VolumeInfo[]> {
  const volumes: VolumeInfo[] = [];
  const volumeNames = new Set<string>();
  
  try {
    const output = await execCommand(
      'docker volume ls --format "{{.Name}}|{{.Driver}}|{{.Mountpoint}}|{{.Scope}}|{{.CreatedAt}}"'
    );
    
    if (output) {
      for (const line of output.split('\n')) {
        const [name, driver, mountpoint, scope, created] = line.split('|');
        if (!name) continue;
        volumeNames.add(name);
        volumes.push({ name, driver, mountpoint, scope, created, type: 'docker' });
      }
    }
  } catch {}

  const projects = projectQueries.getAll();
  for (const project of projects) {
    try {
      const projectDir = path.dirname(project.path);
      const { stdout } = await execAsync(
        `docker compose -f "${project.path}" config --format json`,
        { cwd: projectDir, timeout: 30000 }
      );
      const config = JSON.parse(stdout);
      
      if (config.volumes) {
        for (const [volName, volConfig] of Object.entries(config.volumes)) {
          if (volName.includes(':')) continue;
          
          const fullName = `${project.name.replace(/-/g, '_')}_${volName}`;
          
          if (!volumeNames.has(fullName) && !volumeNames.has(volName)) {
            const driver = (volConfig as any)?.driver || 'local';
            volumes.push({
              name: volName,
              driver,
              mountpoint: '',
              scope: 'local',
              created: '',
              project: project.name,
              type: 'compose'
            });
            volumeNames.add(volName);
          }
        }
      }
    } catch {}
  }

  return volumes.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listNetworks(): Promise<NetworkInfo[]> {
  try {
    const output = await execCommand(
      'docker network ls --format "{{.ID}}|{{.Name}}|{{.Driver}}|{{.Scope}}|{{.Internal}}|{{.CreatedAt}}"'
    );
    
    if (!output) return [];
    
    const networks: NetworkInfo[] = [];
    
    for (const line of output.split('\n')) {
      const [id, name, driver, scope, internal, created] = line.split('|');
      if (!id) continue;
      
      let containers: string[] = [];
      let used = false;
      
      try {
        const inspectOutput = await execCommand(
          `docker network inspect ${name} --format "{{range .Containers}}{{.Name}} {{end}}"`
        );
        containers = inspectOutput.trim().split(' ').filter(Boolean);
        used = containers.length > 0;
      } catch {
        containers = [];
        used = false;
      }
      
      networks.push({ id, name, driver, scope, internal: internal === 'true', created, containers, used });
    }
    
    return networks;
  } catch {
    return [];
  }
}

export async function removeNetwork(networkName: string): Promise<{ success: boolean; output: string }> {
  try {
    await execCommand(`docker network rm ${networkName}`);
    return { success: true, output: 'Réseau supprimé' };
  } catch (error: unknown) {
    const err = error as { stderr?: string; message?: string };
    return { success: false, output: err.stderr || err.message || 'Unknown error' };
  }
}

export async function pruneNetworks(): Promise<{ success: boolean; output: string }> {
  try {
    const output = await execCommand('docker network prune -f');
    return { success: true, output: output || 'Réseaux inutilisés supprimés' };
  } catch (error: unknown) {
    const err = error as { stderr?: string; message?: string };
    return { success: false, output: err.stderr || err.message || 'Unknown error' };
  }
}

export async function listImages(): Promise<ImageInfo[]> {
  try {
    const output = await execCommand(
      'docker images --format "{{.ID}}|{{.Repository}}|{{.Tag}}|{{.Size}}|{{.CreatedAt}}"'
    );
    
    if (!output) return [];
    
    const images: ImageInfo[] = [];
    
    for (const line of output.split('\n')) {
      const [id, repository, tag, size, created] = line.split('|');
      if (!id) continue;
      
      const img: ImageInfo = { id, repository, tag, size, created, used: false };
      
      try {
        const usedOutput = await execCommand(
          `docker ps -aq --filter "ancestor=${repository}:${tag}" | head -1`
        );
        img.used = usedOutput.trim().length > 0;
      } catch {
        img.used = false;
      }
      
      images.push(img);
    }
    
    return images;
  } catch {
    return [];
  }
}

export async function removeImage(imageId: string, force = false): Promise<{ success: boolean; output: string }> {
  try {
    const flag = force ? '-f' : '';
    await execCommand(`docker rmi ${flag} ${imageId}`);
    return { success: true, output: 'Image supprimée' };
  } catch (error: unknown) {
    const err = error as { stderr?: string; message?: string };
    return { success: false, output: err.stderr || err.message || 'Unknown error' };
  }
}

export async function pruneImages(danglingOnly = true): Promise<{ success: boolean; output: string }> {
  try {
    const cmd = danglingOnly ? 'docker image prune -f' : 'docker image prune -a -f';
    const output = await execCommand(cmd);
    return { success: true, output: output || 'Images pruned successfully' };
  } catch (error: unknown) {
    const err = error as { stderr?: string; message?: string };
    return { success: false, output: err.stderr || err.message || 'Unknown error' };
  }
}
