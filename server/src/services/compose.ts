import fs from 'fs/promises';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

const HOMER_INTERNAL = 'homer-internal';
const HOMER_SERVICES = 'homer-services';

export interface NetworkResult {
  success: boolean;
  message: string;
}

export interface ServiceInfo {
  name: string;
  hasNetworkMode: boolean;
}

export async function getProjectServices(projectPath: string): Promise<ServiceInfo[]> {
  try {
    const { stdout } = await execAsync(`docker compose -f "${projectPath}" config --format json`, { timeout: 10000 });
    const config = JSON.parse(stdout);
    const services = config.services || {};

    return Object.entries(services).map(([name, svc]) => {
      const service = svc as Record<string, unknown>;
      return {
        name,
        hasNetworkMode: service.network_mode === 'host' ||
                       (typeof service.network_mode === 'string' &&
                        service.network_mode.startsWith('service:')),
      };
    });
  } catch {
    return [];
  }
}

export async function addProjectToHomerNetwork(projectPath: string, selectedServices?: string[]): Promise<NetworkResult> {
  try {
    let services: Record<string, unknown> = {};
    try {
      const { stdout } = await execAsync(`docker compose -f "${projectPath}" config --format json`, { timeout: 10000 });
      const config = JSON.parse(stdout);
      services = config.services || {};
    } catch {
      return { success: false, message: 'Could not parse compose file' };
    }

    const allServiceNames = Object.keys(services);
    const targetServices = selectedServices && selectedServices.length > 0 
      ? allServiceNames.filter(s => selectedServices.includes(s))
      : allServiceNames;

    if (targetServices.length === 0) {
      return { success: false, message: 'No services selected' };
    }

    const incompatible = targetServices
      .filter(name => {
        const svc = services[name] as Record<string, unknown>;
        return svc.network_mode === 'host' || (typeof svc.network_mode === 'string' && svc.network_mode.startsWith('service:'));
      });

    if (incompatible.length > 0) {
      return { success: false, message: `Services with network_mode cannot join additional networks: ${incompatible.join(', ')}` };
    }

    const composeContent = await fs.readFile(projectPath, 'utf-8');

    const networkExists = composeContent.includes(`${HOMER_SERVICES}:`) ||
                       composeContent.includes(`- ${HOMER_SERVICES}`);

    if (networkExists) {
      return { success: true, message: 'Network already configured' };
    }

    const hasTopLevelNetworks = composeContent.split('\n').some(l => l.match(/^networks:\s*$/));

    const backupPath = `${projectPath}.bak`;
    await fs.copyFile(projectPath, backupPath);

    let newCompose: string;
    if (hasTopLevelNetworks) {
      newCompose = addNetworkToExistingCompose(composeContent, targetServices);
    } else {
      newCompose = addNetworkToNewCompose(composeContent, targetServices);
    }

    await fs.writeFile(projectPath, newCompose, 'utf-8');

    try {
      await execAsync(`docker compose -f "${projectPath}" config --quiet`, { timeout: 10000 });
    } catch (validateErr) {
      await fs.copyFile(backupPath, projectPath);
      return { success: false, message: 'Generated compose file is invalid, original restored' };
    } finally {
      try { await fs.unlink(backupPath); } catch {}
    }

    return { success: true, message: 'Network added to compose file' };
  } catch (error) {
    const err = error as Error;
    return { success: false, message: err.message };
  }
}

function findBlockEnd(lines: string[], startIdx: number, minIndent: number): number {
  let idx = startIdx + 1;
  let lastContent = startIdx;
  while (idx < lines.length) {
    const line = lines[idx];
    if (line.trim() === '') { idx++; continue; }
    const indent = line.search(/\S/);
    if (indent < minIndent) break;
    lastContent = idx;
    idx++;
  }
  return lastContent + 1;
}

function addNetworkToService(lines: string[], serviceName: string): boolean {
  const serviceIdx = lines.findIndex(l => l.match(new RegExp(`^  ${serviceName}:\\s*$`)));
  if (serviceIdx === -1) return false;

  let idx = serviceIdx + 1;
  while (idx < lines.length) {
    const line = lines[idx];
    if (line.trim() === '') { idx++; continue; }
    const indent = line.search(/\S/);
    if (indent < 4) break;
    if (indent === 4 && line.match(/^    networks:\s*$/)) {
      let nextIdx = idx + 1;
      while (nextIdx < lines.length && lines[nextIdx].trim() === '') nextIdx++;
      if (nextIdx < lines.length && lines[nextIdx].match(/^\s{6,}-\s/)) {
        const listEnd = findBlockEnd(lines, idx, 6);
        lines.splice(listEnd, 0, `      - ${HOMER_SERVICES}`);
      } else {
        const mapEnd = findBlockEnd(lines, idx, 6);
        lines.splice(mapEnd, 0, `      ${HOMER_SERVICES}:`);
      }
      return true;
    }
    idx++;
  }
  const insertAt = findBlockEnd(lines, serviceIdx, 4);
  lines.splice(insertAt, 0, `    networks:`, `      - ${HOMER_SERVICES}`);
  return true;
}

function addNetworkToExistingCompose(compose: string, targetServices: string[]): string {
  const lines = compose.split('\n');

  for (const serviceName of targetServices) {
    addNetworkToService(lines, serviceName);
  }

  const netIdx = lines.findIndex(l => l.match(/^networks:\s*$/));
  if (netIdx !== -1) {
    const insertAt = findBlockEnd(lines, netIdx, 2);
    lines.splice(insertAt, 0, `  ${HOMER_SERVICES}:`, `    external: true`);
  }

  return lines.join('\n');
}

function addNetworkToNewCompose(compose: string, targetServices: string[]): string {
  const lines = compose.split('\n');

  for (const serviceName of targetServices) {
    addNetworkToService(lines, serviceName);
  }

  lines.push('');
  lines.push('networks:');
  lines.push(`  ${HOMER_SERVICES}:`);
  lines.push('    external: true');
  lines.push('');

  return lines.join('\n');
}

export async function ensureHomerNetworkExists(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`docker network inspect ${HOMER_SERVICES}`, { timeout: 5000 });
    return stdout.includes('Containers');
  } catch {
    try {
      await execAsync(`docker network create ${HOMER_SERVICES}`, { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }
}