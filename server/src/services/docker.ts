import { exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { projectQueries, type Project } from '../db/index.js';
import { getComposeProjectName, getMountHint } from './compose-project-name.js';
import { checkImageUpdateWithPolicy } from './registry.js';
import { assertValidId, assertValidImageRef } from './docker-args.js';
import { parseComposeInfo, buildDockerRunArgs, type DockerInspect } from './container-recreate.js';
import { composePullChanged } from './compose-pull.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

interface VolumeUsageInfo {
  containers: string[];
  projects: string[];
}

interface ContainerVolumesResult {
  projectVolumes: Map<string, Set<string>>;
  usedVolumePaths: Set<string>;
  volumeUsage: Map<string, VolumeUsageInfo>;
}

async function getProjectFromContainers(): Promise<ContainerVolumesResult> {
  const projectVolumes = new Map<string, Set<string>>();
  const usedVolumePaths = new Set<string>();
  const volumeUsage = new Map<string, VolumeUsageInfo>();
  
  try {
    const { stdout: containersOutput } = await execAsync(
      'docker ps -a --format "{{.Names}}"'
    );
    
    for (const containerName of containersOutput.split('\n').filter(Boolean)) {
      try {
        const { stdout: projectLabel } = await execAsync(
          `docker inspect ${containerName} --format '{{index .Config.Labels "com.docker.compose.project"}}'`
        );
        const { stdout: serviceLabel } = await execAsync(
          `docker inspect ${containerName} --format '{{index .Config.Labels "com.docker.compose.service"}}'`
        );
        
        const project = projectLabel.trim();
        
        const { stdout: volumesOutput } = await execAsync(
          `docker inspect ${containerName} --format '{{range .Mounts}}{{.Source}}|{{end}}'`
        );
        
        const containerVolumes = volumesOutput.split('|').filter(Boolean);
        for (const vol of containerVolumes) {
          usedVolumePaths.add(vol);
          
          const mountpointVol = vol.match(/^\/var\/lib\/docker\/volumes\/([^/]+)\/_data$/);
          if (mountpointVol) {
            usedVolumePaths.add(mountpointVol[1]);
          }
          
          if (!volumeUsage.has(vol)) {
            volumeUsage.set(vol, { containers: [], projects: [] });
          }
          volumeUsage.get(vol)!.containers.push(containerName);
          if (project && !volumeUsage.get(vol)!.projects.includes(project)) {
            volumeUsage.get(vol)!.projects.push(project);
          }
          
          if (mountpointVol) {
            const volName = mountpointVol[1];
            if (!volumeUsage.has(volName)) {
              volumeUsage.set(volName, { containers: [], projects: [] });
            }
            volumeUsage.get(volName)!.containers.push(containerName);
            if (project && !volumeUsage.get(volName)!.projects.includes(project)) {
              volumeUsage.get(volName)!.projects.push(project);
            }
          }
        }
        
        if (project) {
          if (!projectVolumes.has(project)) {
            projectVolumes.set(project, new Set());
          }
          
          for (const vol of containerVolumes) {
            projectVolumes.get(project)!.add(vol);
          }
        }
      } catch {}
    }
  } catch {}
  
  return { projectVolumes, usedVolumePaths, volumeUsage };
}

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
  exposedPorts?: string[];
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
  service?: string;
  type?: 'docker' | 'compose' | 'bind';
  hostPath?: string;
  containerPath?: string;
  size?: string;
  orphan?: boolean;
  usedBy?: { containers: string[]; projects: string[] };
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
  projects?: string[];
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
    
    const containers: Container[] = output.split('\n').map(line => {
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

    const containerIds = containers.filter(c => c.id).map(c => c.id);
    if (containerIds.length > 0) {
      try {
        const ids = containerIds.join(' ');
        const inspectOutput = await execCommand(
          `docker inspect --format '{{.Id}}|{{json .Config.ExposedPorts}}' ${ids}`
        );
        const exposedMap = new Map<string, string[]>();
        for (const line of inspectOutput.split('\n')) {
          if (!line.trim()) continue;
          const sepIdx = line.indexOf('|');
          if (sepIdx === -1) continue;
          const cid = line.slice(0, sepIdx);
          const jsonStr = line.slice(sepIdx + 1);
          if (jsonStr === '<no value>' || jsonStr === 'null' || !jsonStr) continue;
          try {
            const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
            exposedMap.set(cid, Object.keys(parsed).map(k => k.split('/')[0]));
          } catch {}
        }
        for (const c of containers) {
          const fullId = [...exposedMap.keys()].find(k => k.startsWith(c.id));
          if (fullId) {
            c.exposedPorts = exposedMap.get(fullId)!;
          }
        }
      } catch {
        for (const cid of containerIds) {
          try {
            const line = await execCommand(
              `docker inspect --format '{{.Id}}|{{json .Config.ExposedPorts}}' ${cid}`
            );
            if (!line.trim()) continue;
            const sepIdx = line.indexOf('|');
            if (sepIdx === -1) continue;
            const jsonStr = line.slice(sepIdx + 1);
            if (jsonStr === '<no value>' || jsonStr === 'null' || !jsonStr) continue;
            const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
            const ports = Object.keys(parsed).map(k => k.split('/')[0]);
            const container = containers.find(c => cid.startsWith(c.id) || c.id.startsWith(cid));
            if (container && ports.length > 0) {
              container.exposedPorts = ports;
            }
          } catch {}
        }
      }
    }

    return containers;
  } catch {
    return [];
  }
}

export async function listProjectContainers(project: Pick<Project, 'path' | 'compose_project'>): Promise<Container[]> {
  const containers = await listContainers();
  const projectName = getComposeProjectName(project);
  return containers.filter(c => c.project === projectName);
}

/**
 * Whether the project's compose file is readable from inside Homer's
 * container. Always true for Homer-managed projects (they live in the data
 * dir); external projects need an identical-path volume mount. Probed live so
 * adding the mount later upgrades the project without any DB change.
 */
export async function isProjectFileAccessible(project: Pick<Project, 'path' | 'external'>): Promise<boolean> {
  if (!project.external) return true;
  try {
    await fs.access(project.path);
    return true;
  } catch {
    return false;
  }
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
    assertValidId(containerId);
    const tailN = Number.isFinite(tail) ? Math.max(0, Math.floor(tail)) : 100;
    return await execCommand(`docker logs ${containerId} --tail ${tailN} 2>&1`);
  } catch {
    return '';
  }
}

export async function clearContainerLogs(containerId: string): Promise<{ success: boolean; output: string }> {
  try {
    assertValidId(containerId);
    const logPath = (await execCommand(`docker inspect --format='{{.LogPath}}' ${containerId}`)).trim();
    if (!logPath) {
      return { success: false, output: 'Could not determine log file path' };
    }
    // Try direct truncation first (works when host filesystem is accessible)
    try {
      await fs.truncate(logPath, 0);
      return { success: true, output: '' };
    } catch {
      // Fallback: mount the log file into a short-lived container and truncate from there
      await execCommand(`docker run --rm -v "${logPath}:/logfile" alpine sh -c "> /logfile"`);
      return { success: true, output: '' };
    }
  } catch (error: unknown) {
    const err = error as { message?: string };
    return { success: false, output: err.message || 'Failed to clear logs' };
  }
}

export async function startContainer(containerId: string): Promise<void> {
  assertValidId(containerId);
  await execCommand(`docker start ${containerId}`);
}

export async function stopContainer(containerId: string): Promise<void> {
  assertValidId(containerId);
  await execCommand(`docker stop ${containerId}`);
}

export async function restartContainer(containerId: string): Promise<void> {
  assertValidId(containerId);
  await execCommand(`docker restart ${containerId}`);
}

export async function removeContainer(containerId: string): Promise<{ success: boolean; output: string }> {
  try {
    assertValidId(containerId);
    await execCommand(`docker rm -f ${containerId}`);
    return { success: true, output: 'Container supprimé' };
  } catch (error: unknown) {
    const err = error as { stderr?: string; message?: string };
    return { success: false, output: err.stderr || err.message || 'Unknown error' };
  }
}

export async function updateContainerImage(containerId: string): Promise<{ success: boolean; output: string }> {
  try {
    assertValidId(containerId);

    // Read the full configuration BEFORE touching the container, so nothing is
    // lost when it is recreated.
    const rawInspect = await execFileAsync('docker', ['inspect', containerId], { timeout: 30000 });
    const inspected = JSON.parse(rawInspect.stdout) as DockerInspect[];
    const container = inspected[0];
    const imageName = container?.Config?.Image;
    if (!imageName) {
      return { success: false, output: 'Image du container non trouvée' };
    }
    assertValidImageRef(imageName);
    await execFileAsync('docker', ['pull', imageName], { timeout: 300000 });

    // Compose-managed container: let compose recreate it so the entire service
    // definition (ports, env, volumes, networks, depends_on…) is preserved.
    const composeInfo = parseComposeInfo(container.Config?.Labels);
    if (composeInfo) {
      const fileArgs = composeInfo.configFiles.flatMap(f => ['-f', f]);
      const opts = composeInfo.workingDir ? { cwd: composeInfo.workingDir, timeout: 120000 } : { timeout: 120000 };
      await execFileAsync(
        'docker',
        ['compose', ...fileArgs, '-p', composeInfo.project, 'up', '-d', '--pull', 'always', '--force-recreate', composeInfo.service],
        opts,
      );
      return { success: true, output: `Container mis à jour avec l'image ${imageName}` };
    }

    // Standalone container: rebuild the run configuration from inspect.
    const { args, extraNetworks } = buildDockerRunArgs(container);
    await execFileAsync('docker', ['stop', containerId], { timeout: 30000 }).catch(() => {});
    await execFileAsync('docker', ['rm', '-f', containerId], { timeout: 30000 });
    await execFileAsync('docker', args, { timeout: 60000 });
    for (const net of extraNetworks) {
      const name = (container.Name ?? '').replace(/^\//, '');
      if (name) await execFileAsync('docker', ['network', 'connect', net, name], { timeout: 30000 }).catch(() => {});
    }

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

  if (!(await isProjectFileAccessible(project))) {
    return { success: false, output: getMountHint(project.path) };
  }

  const projectDir = path.dirname(project.path);
  const projectName = getComposeProjectName(project);
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
  const projectName = getComposeProjectName(project);
  const flags = options.removeVolumes ? ' --volumes' : '';
  // Without file access, `down` still works purely from the compose labels.
  const accessible = await isProjectFileAccessible(project);
  const command = accessible
    ? `docker compose -f "${project.path}" -p "${projectName}" down${flags}`
    : `docker compose -p "${projectName}" down${flags}`;

  try {
    const { stdout, stderr } = await execAsync(command, { cwd: accessible ? projectDir : undefined, timeout: 60000 });
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

  if (!(await isProjectFileAccessible(project))) {
    return { changed: false, output: getMountHint(project.path) };
  }

  const projectDir = path.dirname(project.path);
  const projectName = getComposeProjectName(project);

  try {
    const pullOutput = await execCommand(`docker compose -f "${project.path}" -p "${projectName}" pull`);

    const pullChanged = composePullChanged(pullOutput);

    if (pullChanged) {
      await execCommand(`docker compose -f "${project.path}" -p "${projectName}" up -d --pull always --force-recreate`);
    }
    
    try {
      await execCommand('docker image prune -f');
    } catch {}

    return { changed: pullChanged, output: `Update completed. Images ${pullChanged ? 'were' : 'were not'} changed.` };
  } catch (error: unknown) {
    const err = error as { stderr?: string };
    return { changed: false, output: err.stderr || 'Unknown error' };
  }
}

export function updateProjectImagesStream(
  projectId: number,
  onLine: (line: string) => void,
  onDone: (success: boolean, changed: boolean) => void,
): () => void {
  const project = projectQueries.getById(projectId);
  if (!project) {
    onLine('Error: Project not found');
    onDone(false, false);
    return () => {};
  }

  if (project.external && !existsSync(project.path)) {
    onLine(getMountHint(project.path));
    onDone(false, false);
    return () => {};
  }

  const projectDir = path.dirname(project.path);
  const projectName = getComposeProjectName(project);

  let pullChanged = false;
  const commands = [
    { args: ['compose', '-f', project.path, '-p', projectName, 'pull'], label: 'pull' },
    { args: ['compose', '-f', project.path, '-p', projectName, 'up', '-d', '--pull', 'always', '--force-recreate'], label: 'up' },
  ];

  let cmdIndex = 0;
  let child: ReturnType<typeof spawn> | null = null;
  let pullOutput = '';

  const runNext = () => {
    if (cmdIndex >= commands.length) {
      onDone(true, pullChanged);
      return;
    }

    const { args, label } = commands[cmdIndex++];
    child = spawn('docker', args, { cwd: projectDir, stdio: ['ignore', 'pipe', 'pipe'] });

    const handleData = (data: Buffer) => {
      const text = String(data);
      if (label === 'pull') pullOutput += text;
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.length > 0) onLine(line);
      }
    };

    child.stdout?.on('data', handleData);
    child.stderr?.on('data', handleData);

    child.on('error', (err) => {
      onLine(`spawn error: ${err.message}`);
      onDone(false, false);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        onDone(false, false);
        return;
      }
      if (label === 'pull') {
        pullChanged = composePullChanged(pullOutput);
        // Nothing new was pulled — skip the force-recreate.
        if (!pullChanged) {
          onDone(true, false);
          return;
        }
      }
      runNext();
    });
  };

  runNext();

  return () => {
    try { child?.kill('SIGTERM'); } catch {}
  };
}

export async function checkProjectImageUpdates(projectId: number): Promise<{ hasUpdates: boolean; services: string[] }> {
  const project = projectQueries.getById(projectId);
  if (!project) return { hasUpdates: false, services: [] };

  // Runs in the periodic auto-update loop — skip silently when the external
  // project's file is out of reach rather than logging an error every cycle.
  if (!(await isProjectFileAccessible(project))) return { hasUpdates: false, services: [] };

  const projectDir = path.dirname(project.path);
  const projectName = getComposeProjectName(project);
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
    assertValidImageRef(imageName);
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

  if (project.external && !existsSync(project.path)) {
    onLine(getMountHint(project.path));
    onDone(false);
    return () => {};
  }

  const projectDir = path.dirname(project.path);
  const projectName = getComposeProjectName(project);

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

  let errored = false;
  child.on('error', (err) => {
    errored = true;
    onLine(`spawn error: ${err.message} (cwd=${projectDir}, file=${project.path})`);
    onDone(false);
  });

  child.on('close', (code) => {
    if (!errored) onDone(code === 0);
  });

  return () => {
    try { child.kill('SIGTERM'); } catch {}
  };
}

export function downProjectStream(
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
  const projectName = getComposeProjectName(project);
  // Without file access, `down` still works purely from the compose labels.
  const accessible = !project.external || existsSync(project.path);
  const args = accessible
    ? ['compose', '-f', project.path, '-p', projectName, 'down']
    : ['compose', '-p', projectName, 'down'];

  const child = spawn('docker', args, {
    cwd: accessible ? projectDir : undefined,
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

  let errored = false;
  child.on('error', (err) => {
    errored = true;
    onLine(`spawn error: ${err.message} (cwd=${projectDir}, file=${project.path})`);
    onDone(false);
  });

  child.on('close', (code) => {
    if (!errored) onDone(code === 0);
  });

  return () => {
    try { child.kill('SIGTERM'); } catch {}
  };
}

export async function streamLogs(containerId: string, callback: (line: string) => void): Promise<() => void> {
  assertValidId(containerId);
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
  const dockerVolumeNames: string[] = [];
  
  const { projectVolumes, usedVolumePaths, volumeUsage } = await getProjectFromContainers();
  
  // Get all Docker volumes
  try {
    const { stdout } = await execAsync(
      'docker volume ls --format "{{.Name}}|{{.Driver}}|{{.Mountpoint}}|{{.Scope}}"'
    );
    
    if (stdout) {
      for (const line of stdout.split('\n').filter(l => l.trim())) {
        const parts = line.split('|');
        const name = parts[0]?.trim();
        const driver = parts[1]?.trim() || 'local';
        const mountpoint = parts[2]?.trim() || '';
        const scope = parts[3]?.trim() || 'local';
        
        if (!name) continue;
        
        volumeNames.add(name);
        dockerVolumeNames.push(name);
        
        let orphan = !usedVolumePaths.has(name) && !usedVolumePaths.has(`/var/lib/docker/volumes/${name}/_data`);
        
        const mountPath = `/var/lib/docker/volumes/${name}/_data`;
        let usedBy: { containers: string[]; projects: string[] } | undefined;
        if (usedVolumePaths.has(name) || usedVolumePaths.has(mountPath)) {
          const volKey = usedVolumePaths.has(name) ? name : mountPath;
          usedBy = volumeUsage.get(volKey);
        }
        
        volumes.push({ name, driver, mountpoint, scope, created: '', type: 'docker', orphan, usedBy });
      }
    }
  } catch {}

  // Get Docker volume sizes and creation dates via bulk inspect
  if (dockerVolumeNames.length > 0) {
    try {
      const { stdout } = await execAsync(
        `docker volume inspect ${dockerVolumeNames.map(n => `"${n}"`).join(' ')}`,
        { timeout: 15000 }
      );
      if (stdout) {
        const inspected = JSON.parse(stdout);
        for (const v of Array.isArray(inspected) ? inspected : [inspected]) {
          const vol = volumes.find(vol => vol.name === v.Name && vol.type === 'docker');
          if (vol) {
            if (v.CreatedAt) vol.created = v.CreatedAt;
            if (v.UsageData?.Size !== undefined && v.UsageData?.Size !== null && v.UsageData.Size > 0) {
              const bytes = v.UsageData.Size;
              if (bytes >= 1073741824) vol.size = `${(bytes / 1073741824).toFixed(1)}GB`;
              else if (bytes >= 1048576) vol.size = `${(bytes / 1048576).toFixed(1)}MB`;
              else if (bytes >= 1024) vol.size = `${(bytes / 1024).toFixed(1)}KB`;
              else vol.size = `${bytes}B`;
            }
          }
        }
      }
    } catch {}

    // Fallback: get sizes from docker system df
    const volsWithoutSize = volumes.filter(v => v.type === 'docker' && !v.size);
    if (volsWithoutSize.length > 0) {
      try {
        const { stdout } = await execAsync('docker system df -v --format json', { timeout: 30000 });
        if (stdout) {
          for (const line of stdout.split('\n').filter(l => l.trim())) {
            try {
              const obj = JSON.parse(line);
              if (obj.Volumes) {
                for (const v of obj.Volumes) {
                  if (v.Name && v.Size) {
                    const vol = volsWithoutSize.find(vol => vol.name === v.Name);
                    if (vol) vol.size = v.Size;
                  }
                }
              }
            } catch {}
          }
        }
      } catch {}
    }
  }

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
            
            const projectVols = projectVolumes.get(project.name);
            const isUsed = projectVols && Array.from(projectVols).some(v => 
              v.includes(fullName) || v.includes(volName)
            );
            
            let usedBy: { containers: string[]; projects: string[] } | undefined;
            if (isUsed) {
              const containers: string[] = [];
              for (const [, usage] of volumeUsage) {
                if (usage.projects.includes(project.name)) {
                  containers.push(...usage.containers);
                }
              }
              usedBy = { 
                containers: [...new Set(containers)], 
                projects: [project.name] 
              };
            }
            
            volumes.push({
              name: volName,
              driver,
              mountpoint: '',
              scope: 'local',
              created: '',
              project: project.name,
              type: 'compose',
              orphan: !isUsed,
              usedBy
            });
            volumeNames.add(volName);
          }
        }
      }

      if (config.services) {
        for (const [serviceName, serviceConfig] of Object.entries(config.services as Record<string, any>)) {
          const serviceVolumes = (serviceConfig as any)?.volumes || [];
          for (const vol of serviceVolumes) {
            if (typeof vol === 'string' && !vol.includes(':')) continue;
            
            let hostPath = '';
            let containerPath = '';
            
            if (typeof vol === 'string') {
              const parts = vol.split(':');
              hostPath = parts[0];
              containerPath = parts[1] || parts[0];
            } else if (typeof vol === 'object' && vol.type === 'bind') {
              hostPath = vol.source || '';
              containerPath = vol.target || '';
            } else {
              continue;
            }

            if (hostPath.startsWith('/') || hostPath.startsWith('.')) {
              let resolvedHostPath = hostPath;
              if (hostPath.startsWith('.')) {
                resolvedHostPath = path.resolve(projectDir, hostPath);
              }
              
              const volKey = `${project.name}:${serviceName}:${hostPath}`;
              if (!volumeNames.has(volKey)) {
                let usedContainers: string[] = [];
                let usedProjects: string[] = [];
                for (const [volPath, usage] of volumeUsage) {
                  if (volPath === resolvedHostPath) {
                    usedContainers.push(...usage.containers);
                    usedProjects.push(...usage.projects);
                  }
                }
                usedProjects = [...new Set(usedProjects)];
                usedContainers = [...new Set(usedContainers)];
                
                let size = '';
                try {
                  const { stdout } = await execAsync(
                    `du -sh "${resolvedHostPath}" 2>/dev/null || echo ""`,
                    { timeout: 15000 }
                  );
                  size = stdout.trim().split('\t')[0] || '';
                } catch {}
                
                volumes.push({
                  name: hostPath.split('/').pop() || hostPath,
                  driver: 'bind',
                  mountpoint: resolvedHostPath,
                  scope: 'local',
                  created: '',
                  project: project.name,
                  service: serviceName,
                  type: 'bind',
                  hostPath: resolvedHostPath,
                  containerPath,
                  size,
                  usedBy: usedContainers.length > 0 ? { containers: usedContainers, projects: usedProjects } : undefined
                });
                volumeNames.add(volKey);
              }
            }
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
    assertValidId(networkName);
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
    const [imagesOutput, containersOutput] = await Promise.all([
      execCommand('docker images --format "{{.ID}}|{{.Repository}}|{{.Tag}}|{{.Size}}|{{.CreatedAt}}"'),
      execCommand('docker ps -a --format "{{.Image}}|{{.Labels}}"'),
    ]);

    if (!imagesOutput) return [];

    // Map imageRef (repo:tag) ou shortId (sha256 containers) → projets compose
    const usedByName = new Map<string, Set<string>>();  // "repo:tag" → projects
    const usedByShortId = new Map<string, Set<string>>(); // 12-char id → projects (pour les containers référençant sha256:...)

    if (containersOutput) {
      for (const line of containersOutput.split('\n')) {
        const pipeIdx = line.indexOf('|');
        if (pipeIdx === -1) continue;
        const rawImage = line.slice(0, pipeIdx).trim();
        const labels = line.slice(pipeIdx + 1);
        if (!rawImage) continue;

        const project = labels.match(/com\.docker\.compose\.project=([^,]+)/)?.[1];

        if (rawImage.startsWith('sha256:')) {
          // Container référencé par digest — on match par les 12 premiers chars de l'ID
          const shortId = rawImage.slice(7, 19);
          if (!usedByShortId.has(shortId)) usedByShortId.set(shortId, new Set());
          if (project) usedByShortId.get(shortId)!.add(project);
        } else {
          // Normalise "nginx" → "nginx:latest"
          const normalized = rawImage.includes(':') ? rawImage : `${rawImage}:latest`;
          if (!usedByName.has(normalized)) usedByName.set(normalized, new Set());
          if (project) usedByName.get(normalized)!.add(project);
        }
      }
    }

    return imagesOutput.split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [id, repository, tag, size, created] = line.split('|');
        if (!id) return null;
        const imageRef = `${repository}:${tag}`;
        const projectsByName = usedByName.get(imageRef);
        const projectsById = usedByShortId.get(id);
        const allProjects = new Set([
          ...(projectsByName ?? []),
          ...(projectsById ?? []),
        ]);
        return {
          id, repository, tag, size, created,
          used: projectsByName !== undefined || projectsById !== undefined,
          projects: allProjects.size ? Array.from(allProjects) : undefined,
        };
      })
      .filter((img): img is NonNullable<typeof img> => img !== null) as ImageInfo[];
  } catch {
    return [];
  }
}

export async function removeImage(imageId: string, force = false): Promise<{ success: boolean; output: string }> {
  try {
    assertValidImageRef(imageId);
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

export async function removeVolume(volumeName: string): Promise<{ success: boolean; output: string }> {
  try {
    assertValidId(volumeName);
    await execCommand(`docker volume rm "${volumeName}"`);
    return { success: true, output: `Volume "${volumeName}" supprimé` };
  } catch (error: unknown) {
    const err = error as { stderr?: string; message?: string };
    return { success: false, output: err.stderr || err.message || 'Unknown error' };
  }
}

export async function pruneVolumes(): Promise<{ success: boolean; output: string }> {
  try {
    const output = await execCommand('docker volume prune -f');
    return { success: true, output: output || 'Volumes non utilisés supprimés' };
  } catch (error: unknown) {
    const err = error as { stderr?: string; message?: string };
    return { success: false, output: err.stderr || err.message || 'Unknown error' };
  }
}
