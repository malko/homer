import { spawn } from 'child_process';
import { getRunningVersionAsync } from './version.js';
import { getOwnComposeInfo, getOwnImage } from './compose-discovery.js';
import { buildRecreatePlan, buildHelperRunArgs } from './mount-override.js';
import { getPublishedVersions, parseImageRef } from './registry.js';

const GITHUB_REPO = process.env.HOMER_GITHUB_REPO || 'malko/homer';
const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;

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

  const detected = await detectFromContainer();
  if (detected) {
    _cachedConfig = detected;
    return _cachedConfig;
  }

  return { image: '', composeFile: '' };
}

export async function isConfigured(): Promise<boolean> {
  const config = await getConfig();
  return !!(GITHUB_REPO && config.image && config.composeFile);
}

export async function getCurrentVersion(): Promise<string> {
  return getRunningVersionAsync();
}

async function getLatestGitVersion(): Promise<string | null> {
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/tags`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'homer' },
    });
    if (!res.ok) {
      console.error(`[updater] GitHub tags API error: ${res.status} ${res.statusText}`);
      return null;
    }
    const tags = await res.json() as { name?: string }[];
    if (!Array.isArray(tags) || tags.length === 0) {
      console.error('[updater] No tags found in GitHub response');
      return null;
    }
    const latestTag = tags[0]?.name;
    return latestTag?.replace(/^v/, '') ?? null;
  } catch (error) {
    console.error('[updater] Failed to fetch latest version:', error);
    return null;
  }
}

/** Latest version tags actually published to the image registry, or null when unknown. */
async function getPublishedVersionsForSelf(): Promise<string[] | null> {
  const image = await getOwnImage();
  if (!image) return null;
  // Only trust a tag listing when the registry is explicit (GHCR for Homer's
  // own image). A bare local name like "homer:local" would otherwise be looked
  // up as an unrelated Docker Hub repository.
  if (parseImageRef(image).registry !== 'ghcr.io') return null;
  return getPublishedVersions(image);
}

export function isNewer(latest: string, current: string): boolean {
  if (current === 'dev') return false;
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [la, lb, lc] = parse(latest);
  const [ca, cb, cc] = parse(current);
  return la > ca || (la === ca && lb > cb) || (la === ca && lb === cb && lc > cc);
}

/** Highest of two version strings, ignoring nulls. */
export function pickLatestVersion(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return isNewer(a, b) ? a : b;
}

/** True when a pull left the local image untouched. Only a positive match counts. */
export function imageUnchanged(before: string | null, after: string | null): boolean {
  return Boolean(before && after && before === after);
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  /** A newer version is announced (git tag or published image). */
  updateAvailable: boolean;
  /** The announced version's image is published, so an in-app update can be offered. */
  imageAvailable: boolean;
  configured: boolean;
  releasesUrl: string;
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = await getCurrentVersion();
  const configured = await isConfigured();
  const [gitVersion, publishedVersions] = await Promise.all([
    getLatestGitVersion(),
    getPublishedVersionsForSelf(),
  ]);

  const publishedLatest = publishedVersions && publishedVersions.length > 0 ? publishedVersions[0] : null;
  const latestVersion = pickLatestVersion(gitVersion, publishedLatest);
  const updateAvailable = latestVersion ? isNewer(latestVersion, currentVersion) : false;

  // When the registry tells us which versions exist, only offer the in-app
  // update if the announced version is published. When it is unreachable, fall
  // back to offering it (the pull's digest check still prevents a no-op restart).
  const imageAvailable = updateAvailable && (
    publishedVersions === null
      ? true
      : latestVersion !== null && publishedVersions.includes(latestVersion.replace(/^v/, ''))
  );

  return {
    currentVersion,
    latestVersion,
    updateAvailable,
    imageAvailable,
    configured,
    releasesUrl: `${GITHUB_URL}/releases`,
  };
}

/** Local image ID for a reference, or null when it isn't present. */
function getImageId(image: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('docker', ['image', 'inspect', image, '--format', '{{.Id}}'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 && stdout.trim() ? stdout.trim() : null));
  });
}

export function performUpdate(
  onLine: (line: string) => void,
  onPullDone: () => void,
  onError: (msg: string) => void,
  onUpToDate: () => void,
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
    const beforeId = await getImageId(config.image);
    const pullOk = await runSpawn('docker', ['pull', config.image]);
    if (!pullOk) {
      onError('Échec du pull de l\'image');
      return;
    }
    const afterId = await getImageId(config.image);
    if (imageUnchanged(beforeId, afterId)) {
      onLine('Image déjà à jour, aucun redémarrage nécessaire.');
      onUpToDate();
      return;
    }
    onPullDone();
    onLine('Redémarrage via docker compose...');
    // Homer's compose dir is not mounted into its own container: run compose
    // from a detached helper that mounts it host-side and survives Homer's
    // own recreation. Fall back to the in-container command outside Docker.
    const plan = buildRecreatePlan(await getOwnComposeInfo());
    const image = await getOwnImage();
    if (plan && image) {
      const ok = await runSpawn('docker', buildHelperRunArgs(plan, image));
      if (!ok) onError('Échec du lancement du conteneur de redémarrage');
    } else {
      const ok = await runSpawn('docker', ['compose', '-f', config.composeFile, 'up', '-d']);
      if (!ok) onError('Échec du redémarrage via docker compose');
    }
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

    // Preferred path: recreate the stack with docker compose up -d
    // --force-recreate from a detached helper. Unlike `docker restart`, this
    // also applies compose file changes (a freshly created override, edited
    // env…) and survives Homer's own container being replaced.
    const plan = buildRecreatePlan(await getOwnComposeInfo());
    const image = await getOwnImage();
    if (plan && image) {
      onLine('Recréation de la stack via docker compose up -d --force-recreate...');
      const { ok } = await runCommand('docker', buildHelperRunArgs(plan, image, ['--force-recreate']));
      if (ok) {
        onDone();
        return;
      }
      onLine('Échec du lancement du conteneur de redémarrage, repli sur docker restart...');
    }

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
        broadcast({ type: 'update_available', latestVersion: result.latestVersion, imageAvailable: result.imageAvailable });
        // Only auto-apply when the image is actually published; a git tag
        // without an image must never trigger a pointless restart loop.
        if (getAutoUpdate() && result.imageAvailable) {
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
