import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const AVAHI_ENABLED = process.env.AVAHI_ENABLED || 'auto';
const DBUS_SOCKET = '/var/run/dbus/system_bus_socket';
const MDNS_IMAGE = process.env.MDNS_IMAGE || '';

interface MdnsStatus {
  available: boolean;
  enabled: boolean;
  reason?: string;
}

let cachedImage: string | null = null;
let cachedHostIp: string | null = null;

async function getImage(): Promise<string> {
  if (cachedImage) return cachedImage;
  if (MDNS_IMAGE) {
    cachedImage = MDNS_IMAGE;
    return cachedImage;
  }
  try {
    const hostname = process.env.HOSTNAME || process.env.CONTAINER_NAME || '';
    if (hostname) {
      const { stdout } = await execAsync(`docker inspect --format='{{.Config.Image}}' ${hostname}`, { timeout: 5000 });
      cachedImage = stdout.trim();
    }
  } catch {}
  if (!cachedImage) {
    cachedImage = 'alpine';
  }
  return cachedImage;
}

function containerName(domain: string): string {
  return `mdns-${domain.replace(/\./g, '-')}`;
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

async function checkAvailable(): Promise<boolean> {
  try {
    const image = await getImage();
    await execAsync(`docker inspect ${image} 2>/dev/null || docker pull ${image}`, { timeout: 30000 });
    return true;
  } catch {
    return false;
  }
}

async function startPublishProcess(domain: string, ip: string): Promise<boolean> {
  const name = containerName(domain);
  try {
    await execAsync(`docker rm -f ${name} 2>/dev/null || true`);
  } catch {}

  const image = await getImage();

  const cmd = `docker run --rm -d --network host --security-opt apparmor=unconfined ` +
    `-v /var/run/dbus/system_bus_socket:/var/run/dbus/system_bus_socket ` +
    `-e DBUS_SYSTEM_BUS_ADDRESS=unix:path=${DBUS_SOCKET} ` +
    `--name ${name} ${image} avahi-publish -a -R ${domain} ${ip}`;

  try {
    await execAsync(cmd, { timeout: 10000 });
    return true;
  } catch (err) {
    console.error(`[mDNS] Failed to publish ${domain}:`, err);
    return false;
  }
}

async function stopPublishProcess(domain: string): Promise<boolean> {
  const name = containerName(domain);
  try {
    await execAsync(`docker rm -f ${name} 2>/dev/null || true`);
  } catch {}
  return true;
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

  if (!status.available || !status.enabled) {
    return false;
  }

  const ip = await detectHostIp();
  return startPublishProcess(domain, ip);
}

export async function unpublishIfEnabled(domain: string): Promise<boolean> {
  return stopPublishProcess(domain);
}

export async function republishAllMdnsHosts(): Promise<void> {
  const status = await getMdnsStatus();

  if (!status.available || !status.enabled) {
    return;
  }

  const { proxyHostQueries } = await import('../db/index.js');
  const hosts = proxyHostQueries.getAll();
  const ip = await detectHostIp();

  for (const host of hosts) {
    if (host.enabled && host.mdns_enabled) {
      await startPublishProcess(host.domain, ip);
    }
  }
}

export async function cleanupMdns(): Promise<void> {
  const { proxyHostQueries } = await import('../db/index.js');
  const hosts = proxyHostQueries.getAll();

  for (const host of hosts) {
    if (host.mdns_enabled) {
      await stopPublishProcess(host.domain);
    }
  }
}