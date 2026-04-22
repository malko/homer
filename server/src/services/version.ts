import { spawn } from 'child_process';

let cachedVersion: string | null = null;

export function getRunningVersion(): string {
  return cachedVersion || 'dev';
}

export function loadVersion(): void {
  if (cachedVersion) return;
  const hostname = process.env.HOSTNAME;
  if (!hostname) return;

  const child = spawn('docker', ['inspect', hostname, '--format', '{{index .Config.Labels "org.opencontainers.image.version"}}'], { stdio: ['ignore', 'pipe', 'ignore'] });
  child.stdout.on('data', (data: Buffer) => {
    const version = data.toString().trim();
    if (version) cachedVersion = version;
  });
  child.on('close', () => {});
}

export async function getRunningVersionAsync(): Promise<string> {
  if (cachedVersion) return cachedVersion;

  const hostname = process.env.HOSTNAME;
  if (!hostname) return 'dev';

  try {
    const child = spawn('docker', ['inspect', hostname, '--format', '{{index .Config.Labels "org.opencontainers.image.version"}}'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const version = await new Promise<string>((resolve) => {
      let stdout = '';
      child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      child.on('close', () => { resolve(stdout.trim() || 'dev'); });
    });
    return version || 'dev';
  } catch {
    return 'dev';
  }
}