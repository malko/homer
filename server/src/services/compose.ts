import fs from 'fs/promises';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

const HOMER_NETWORK = 'homelab-network';

export interface NetworkResult {
  success: boolean;
  message: string;
}

export async function addProjectToHomerNetwork(projectPath: string): Promise<NetworkResult> {
  try {
    let services: Record<string, unknown> = {};
    try {
      const { stdout } = await execAsync(`docker compose -f "${projectPath}" config --format json`, { timeout: 10000 });
      const config = JSON.parse(stdout);
      services = config.services || {};
    } catch {
      return { success: false, message: 'Could not parse compose file' };
    }

    if (Object.keys(services).length === 0) {
      return { success: false, message: 'No services found in compose file' };
    }

    const incompatible = Object.entries(services)
      .filter(([, svc]) => {
        const s = svc as Record<string, unknown>;
        return s.network_mode === 'host' || (typeof s.network_mode === 'string' && s.network_mode.startsWith('service:'));
      })
      .map(([name]) => name);

    if (incompatible.length > 0) {
      return { success: false, message: `Services with network_mode cannot join additional networks: ${incompatible.join(', ')}` };
    }

    const composeContent = await fs.readFile(projectPath, 'utf-8');

    const networkExists = composeContent.includes(`${HOMER_NETWORK}:`) ||
                       composeContent.includes(`- ${HOMER_NETWORK}`);

    if (networkExists) {
      return { success: true, message: 'Network already configured' };
    }

    const hasNetwork = composeContent.includes('networks:') || composeContent.includes('networks :');

    const backupPath = `${projectPath}.bak`;
    await fs.copyFile(projectPath, backupPath);

    let newCompose: string;
    if (hasNetwork) {
      newCompose = addNetworksToExistingServices(composeContent, services);
    } else {
      newCompose = addNetworksSection(composeContent, services);
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

function addNetworksToExistingServices(compose: string, services: Record<string, unknown>): string {
  let result = compose;
  for (const serviceName of Object.keys(services)) {
    const serviceRegex = new RegExp(`^  ${serviceName}:\\s*$`, 'm');
    if (serviceRegex.test(result)) {
      const lines = result.split('\n');
      const idx = lines.findIndex(l => l.match(serviceRegex));
      if (idx !== -1) {
        let insertIdx = idx + 1;
        while (insertIdx < lines.length && lines[insertIdx].match(/^\s{4}/)) {
          insertIdx++;
        }
        if (insertIdx < lines.length && !lines[insertIdx].includes('networks:')) {
          lines.splice(insertIdx, 0, `      networks:\n        - ${HOMER_NETWORK}`);
        }
      }
      result = lines.join('\n');
    }
  }
  return result;
}

function addNetworksSection(compose: string, services: Record<string, unknown>): string {
  let result = compose;

  result += `\n\nnetworks:\n  ${HOMER_NETWORK}:\n    external: true\n`;

  for (const serviceName of Object.keys(services)) {
    const serviceRegex = new RegExp(`^  ${serviceName}:\\s*$`, 'm');
    if (serviceRegex.test(result)) {
      const lines = result.split('\n');
      const idx = lines.findIndex(l => l.match(serviceRegex));
      if (idx !== -1) {
        let insertIdx = idx + 1;
        while (insertIdx < lines.length && lines[insertIdx].match(/^\s{4}/)) {
          insertIdx++;
        }
        if (insertIdx < lines.length && !lines[insertIdx].includes('networks:')) {
          lines.splice(insertIdx, 0, `      networks:\n        - ${HOMER_NETWORK}`);
        }
      }
      result = lines.join('\n');
    }
  }
  return result;
}

export async function ensureHomerNetworkExists(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`docker network inspect ${HOMER_NETWORK}`, { timeout: 5000 });
    return stdout.includes('Containers');
  } catch {
    try {
      await execAsync(`docker network create ${HOMER_NETWORK}`, { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }
}