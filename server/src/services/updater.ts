import { spawn } from 'child_process';

const GITHUB_REPO = process.env.HOMER_GITHUB_REPO || 'malko/homer';

interface ContainerConfig {
  image: string;
  composeFile: string;
}

let _cachedConfig: ContainerConfig | null = null;

async function detectFromContainer(): Promise<ContainerConfig | null> {
  const hostname = process.env.HOSTNAME;
  if (!hostname) return null;

  const runInspect = (format: string): Promise<string> => {
    return new Promise((resolve) => {
      const child = spawn('docker', ['inspect', hostname, '--format', format], { stdio: ['ignore', 'pipe', 'ignore'] });
      let stdout = '';
      child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      child.on('close', () => resolve(stdout.trim()));
    });
  };

  try {
    const [image, composeFile] = await Promise.all([
      runInspect('{{.Config.Image}}'),
      runInspect('{{index .Config.Labels "com.docker.compose.project.config_files"}}'),
    ]);
    if (image && composeFile) {
      return { image, composeFile };
    }
  } catch {}
  return null;
}

async function getConfig(): Promise<ContainerConfig> {
  if (_cachedConfig) return _cachedConfig;

  if (process.env.HOMER_IMAGE && process.env.HOMER_COMPOSE_FILE) {
    _cachedConfig = { image: process.env.HOMER_IMAGE, composeFile: process.env.HOMER_COMPOSE_FILE };
    return _cachedConfig;
  }

  const detected = await detectFromContainer();
  if (detected) {
    _cachedConfig = detected;
    return _cachedConfig;
  }

  _cachedConfig = {
    image: process.env.HOMER_IMAGE || '',
    composeFile: process.env.HOMER_COMPOSE_FILE || '',
  };
  return _cachedConfig;
}

export async function isConfigured(): Promise<boolean> {
  const config = await getConfig();
  return !!(GITHUB_REPO && config.image && config.composeFile);
}

export function getCurrentVersion(): string {
  return process.env.BUILD_VERSION || 'dev';
}

export async function getLatestVersion(): Promise<string | null> {
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
  const configured = await isConfigured();
  if (!configured) {
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
  (async () => {
    const config = await getConfig();
    if (!config.image || !config.composeFile) {
      onError('Impossible de détecter l\'image ou le fichier compose');
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

    onLine(`Pulling image: ${config.image}`);
    const pullOk = await runSpawn('docker', ['pull', config.image]);
    if (!pullOk) {
      onError('Échec du pull de l\'image');
      return;
    }
    onPullDone();
    onLine('Redémarrage via docker compose...');
    await runSpawn('docker', ['compose', '-f', config.composeFile, 'up', '-d']);
  })();
}

export function restartInstance(
  onLine: (line: string) => void,
  onDone: () => void,
  onError: (msg: string) => void,
): void {
  const hostname = process.env.HOSTNAME || '';

  const runCommand = (cmd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> => {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      const handleData = (data: Buffer) => {
        const str = data.toString();
        stdout += str;
        str.split('\n').forEach(line => { if (line.trim()) onLine(line); });
      };
      child.stdout?.on('data', handleData);
      child.stderr?.on('data', handleData);
      child.on('close', (code) => resolve({ ok: code === 0, stdout }));
    });
  };

  (async () => {
    onLine('Redémarrage de l\'instance...');

    let projectContainers: string[] = [];
    let ownContainerId = hostname;

    if (hostname) {
      const inspect = await runCommand('docker', ['inspect', hostname, '--format', '{{index .Config.Labels "com.docker.compose.project"}}']);
      if (inspect.ok && inspect.stdout.trim()) {
        const project = inspect.stdout.trim();
        onLine(`Projet : ${project}`);
        const list = await runCommand('docker', ['ps', '-q', '--filter', `label=com.docker.compose.project=${project}`]);
        if (list.ok && list.stdout.trim()) {
          projectContainers = list.stdout.trim().split('\n').map(id => id.trim()).filter(Boolean);
        }
      }
    }

    const otherContainers = projectContainers.filter(id => id !== ownContainerId);
    const ownContainer = hostname ? [hostname] : [];

    if (otherContainers.length > 0) {
      onLine(`Redémarrage de ${otherContainers.length} conteneur(s) annexe(s)...`);
      await runCommand('docker', ['restart', ...otherContainers]);
    }

    if (ownContainer.length > 0) {
      onLine('Redémarrage du conteneur principal...');
      await runCommand('docker', ['restart', ...ownContainer]);
    } else if (projectContainers.length === 0) {
      onError('Aucun conteneur à redémarrer');
      return;
    }

    onDone();
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
