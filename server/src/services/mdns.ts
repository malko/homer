import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

const AVAHI_ENABLED = process.env.AVAHI_ENABLED || 'auto';
const MDNS_IMAGE = process.env.MDNS_IMAGE || '';
const MDNS_CONTAINER = 'homer-mdns';
const DATA_DIR = process.env.DATA_DIR || './data';
const CONFIG_PATH = path.join(DATA_DIR, 'mdns.json');

interface MdnsStatus {
  available: boolean;
  enabled: boolean;
  reason?: string;
}

let cachedImage: string | null = null;
let cachedHostIp: string | null = null;
let cachedHostDataDir: string | null = null;

async function getOwnContainerName(): Promise<string> {
  return process.env.HOSTNAME || process.env.CONTAINER_NAME || 'homer';
}

async function getHostDataDir(): Promise<string> {
  if (cachedHostDataDir) return cachedHostDataDir;
  if (process.env.HOST_DATA_DIR) {
    cachedHostDataDir = process.env.HOST_DATA_DIR;
    return cachedHostDataDir;
  }
  try {
    const container = await getOwnContainerName();
    const { stdout } = await execAsync(
      `docker inspect --format='{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}}{{end}}{{end}}' ${container}`,
      { timeout: 5000 }
    );
    const source = stdout.trim();
    if (source) {
      cachedHostDataDir = source;
      return cachedHostDataDir;
    }
  } catch (err) {
    console.error('[mDNS] Failed to detect host data dir:', err);
  }
  const dataDir = path.resolve(DATA_DIR);
  console.warn(`[mDNS] Could not detect host data dir, falling back to ${dataDir}. Set HOST_DATA_DIR if mDNS doesn't work.`);
  cachedHostDataDir = dataDir;
  return cachedHostDataDir;
}

async function getImage(): Promise<string> {
  if (cachedImage) return cachedImage;
  if (MDNS_IMAGE) {
    cachedImage = MDNS_IMAGE;
    return cachedImage;
  }
  try {
    const container = await getOwnContainerName();
    const { stdout } = await execAsync(`docker inspect --format='{{.Config.Image}}' ${container}`, { timeout: 5000 });
    cachedImage = stdout.trim();
  } catch {}
  if (!cachedImage) {
    cachedImage = 'alpine';
  }
  return cachedImage;
}

async function detectHostIp(): Promise<string> {
  if (cachedHostIp) return cachedHostIp;

  const envIp = process.env.HOST_IP;
  if (envIp) {
    cachedHostIp = envIp;
    return cachedHostIp;
  }

  try {
    const image = await getImage();
    const { stdout } = await execAsync(
      `docker run --rm --network host ${image} sh -c "ip -4 route get 8.8.8.8 2>/dev/null | head -1"`,
      { timeout: 15000 }
    );
    const match = stdout.match(/src\s+(\d+\.\d+\.\d+\.\d+)/);
    if (match && match[1]) {
      cachedHostIp = match[1];
      console.log(`[mDNS] Auto-detected host IP: ${cachedHostIp}`);
      return cachedHostIp;
    }
  } catch (err) {
    console.error('[mDNS] Failed to auto-detect host IP:', err);
  }

  cachedHostIp = '127.0.0.1';
  console.warn('[mDNS] Could not detect host IP, falling back to 127.0.0.1. Set HOST_IP env var.');
  return cachedHostIp;
}

async function writeConfig(domains: Array<{ domain: string; ip: string }>): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify({ domains }, null, 2), 'utf-8');
}

async function readConfig(): Promise<Array<{ domain: string; ip: string }>> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw).domains || [];
  } catch {
    return [];
  }
}

async function ensureContainerRunning(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`docker inspect --format='{{.State.Running}}' ${MDNS_CONTAINER}`, { timeout: 5000 });
    if (stdout.trim() === 'true') {
      return true;
    }
  } catch {}

  const image = await getImage();
  try {
    await execAsync(`docker rm -f ${MDNS_CONTAINER} 2>/dev/null || true`, { timeout: 5000 });
  } catch {}

  const hostDataDir = await getHostDataDir();

  const cmd = `docker run -d --name ${MDNS_CONTAINER} ` +
    `--network host --security-opt apparmor=unconfined ` +
    `-v /var/run/dbus/system_bus_socket:/var/run/dbus/system_bus_socket ` +
    `-v ${hostDataDir}:/data ` +
    `--entrypoint /bin/sh ` +
    `${image} /app/server/mdns-supervisor.sh`;

  try {
    await execAsync(cmd, { timeout: 15000 });
    console.log('[mDNS] Supervisor container started');
    return true;
  } catch (err) {
    console.error('[mDNS] Failed to start supervisor container:', err);
    return false;
  }
}

async function isContainerRunning(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`docker inspect --format='{{.State.Running}}' ${MDNS_CONTAINER}`, { timeout: 5000 });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

async function reloadContainer(): Promise<void> {
  try {
    await execAsync(`docker kill -s HUP ${MDNS_CONTAINER}`, { timeout: 5000 });
  } catch {}
}

async function checkAvailable(): Promise<boolean> {
  try {
    const image = await getImage();
    await execAsync(`docker inspect ${image} 2>/dev/null || docker pull ${image}`, { timeout: 30000 });
    return true;
  } catch {
    return false;
  }
}

export async function getMdnsStatus(): Promise<MdnsStatus> {
  const enabled = AVAHI_ENABLED;

  if (enabled === 'false') {
    return { available: false, enabled: false, reason: 'Disabled by AVAHI_ENABLED=false' };
  }

  const available = await checkAvailable();

  if (!available) {
    return { available: false, enabled: enabled === 'true', reason: 'Docker or mDNS image unavailable' };
  }

  return { available: true, enabled: true };
}

export async function publishIfEnabled(domain: string): Promise<boolean> {
  const status = await getMdnsStatus();
  if (!status.available || !status.enabled) return false;

  const ip = await detectHostIp();
  const domains = await readConfig();
  const existing = domains.find(d => d.domain === domain);
  if (existing) {
    existing.ip = ip;
  } else {
    domains.push({ domain, ip });
  }
  await writeConfig(domains);

  if (!await ensureContainerRunning()) return false;
  await reloadContainer();
  return true;
}

export async function unpublishIfEnabled(domain: string): Promise<boolean> {
  const domains = await readConfig();
  const filtered = domains.filter(d => d.domain !== domain);
  await writeConfig(filtered);

  if (await isContainerRunning()) {
    if (filtered.length === 0) {
      try {
        await execAsync(`docker rm -f ${MDNS_CONTAINER}`, { timeout: 5000 });
      } catch {}
    } else {
      await reloadContainer();
    }
  }
  return true;
}

export async function republishAllMdnsHosts(): Promise<void> {
  const status = await getMdnsStatus();
  if (!status.available || !status.enabled) return;

  const { proxyHostQueries } = await import('../db/index.js');
  const hosts = proxyHostQueries.getAll();
  const ip = await detectHostIp();

  const domains: Array<{ domain: string; ip: string }> = [];
  for (const host of hosts) {
    if (host.enabled && host.mdns_enabled) {
      domains.push({ domain: host.domain, ip });
    }
  }
  await writeConfig(domains);

  if (domains.length === 0) {
    try {
      await execAsync(`docker rm -f ${MDNS_CONTAINER} 2>/dev/null || true`, { timeout: 5000 });
    } catch {}
    return;
  }

  if (!await ensureContainerRunning()) return;
  await reloadContainer();
}

export async function cleanupMdns(): Promise<void> {
  try {
    await execAsync(`docker rm -f ${MDNS_CONTAINER} 2>/dev/null || true`, { timeout: 5000 });
  } catch {}
}