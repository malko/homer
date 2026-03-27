import { spawn } from 'child_process';

const GITHUB_REPO = process.env.HOMER_GITHUB_REPO || '';
const HOMER_IMAGE = process.env.HOMER_IMAGE || '';
const HOMER_COMPOSE_FILE = process.env.HOMER_COMPOSE_FILE || '';

export function isConfigured(): boolean {
  return !!(GITHUB_REPO && HOMER_IMAGE && HOMER_COMPOSE_FILE);
}

export function getCurrentVersion(): string {
  return process.env.BUILD_VERSION || 'dev';
}

export async function getLatestVersion(): Promise<string | null> {
  if (!GITHUB_REPO) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { 'User-Agent': 'homer' },
    });
    if (!res.ok) return null;
    const data = await res.json() as { tag_name?: string };
    return data.tag_name?.replace(/^v/, '') ?? null;
  } catch {
    return null;
  }
}

function isNewer(latest: string, current: string): boolean {
  if (current === 'dev') return false;
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [la, lb, lc] = parse(latest);
  const [ca, cb, cc] = parse(current);
  return la > ca || (la === ca && lb > cb) || (la === ca && lb === cb && lc > cc);
}

export async function checkForUpdate(): Promise<{
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  configured: boolean;
}> {
  const currentVersion = getCurrentVersion();
  if (!isConfigured()) {
    return { currentVersion, latestVersion: null, updateAvailable: false, configured: false };
  }
  const latestVersion = await getLatestVersion();
  const updateAvailable = latestVersion ? isNewer(latestVersion, currentVersion) : false;
  return { currentVersion, latestVersion, updateAvailable, configured: true };
}

export function performUpdate(
  onLine: (line: string) => void,
  onPullDone: () => void,
  onError: (msg: string) => void,
): void {
  if (!HOMER_IMAGE || !HOMER_COMPOSE_FILE) {
    onError('HOMER_IMAGE ou HOMER_COMPOSE_FILE non configuré');
    return;
  }

  const runSpawn = (cmd: string, args: string[]): Promise<boolean> => {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      const handleData = (data: Buffer) => {
        String(data).split('\n').forEach(line => { if (line.trim()) onLine(line); });
      };
      child.stdout?.on('data', handleData);
      child.stderr?.on('data', handleData);
      child.on('close', (code) => resolve(code === 0));
    });
  };

  (async () => {
    onLine(`Pulling image: ${HOMER_IMAGE}`);
    const pullOk = await runSpawn('docker', ['pull', HOMER_IMAGE]);
    if (!pullOk) {
      onError('Échec du pull de l\'image');
      return;
    }
    onPullDone();
    onLine('Redémarrage via docker compose...');
    await runSpawn('docker', ['compose', '-f', HOMER_COMPOSE_FILE, 'up', '-d']);
    // Le conteneur courant sera arrêté avant d'arriver ici
  })();
}

export function startAutoUpdateChecker(
  broadcast: (event: { type: string; [key: string]: unknown }) => void,
  getAutoUpdate: () => boolean,
  triggerUpdate: () => void,
): void {
  const check = async () => {
    try {
      const result = await checkForUpdate();
      if (result.updateAvailable) {
        broadcast({ type: 'update_available', latestVersion: result.latestVersion });
        if (getAutoUpdate()) {
          triggerUpdate();
        }
      }
    } catch {}
  };

  // Vérification initiale après 30s (le temps que le serveur démarre complètement)
  setTimeout(check, 30000);
  // Vérification périodique toutes les heures
  setInterval(check, 60 * 60 * 1000);
}
