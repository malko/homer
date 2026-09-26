import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { parseComposeInfo, type ComposeInfo } from './container-recreate.js';

const execFileAsync = promisify(execFile);

export interface DiscoveredComposeProject {
  name: string;
  configFiles: string[];
  workingDir: string | null;
  containerCount: number;
}

/**
 * Group container label sets (from `docker inspect`) into the compose projects
 * that created them. Containers without compose provenance are skipped.
 */
export function groupComposeProjects(labelSets: Array<Record<string, string> | null | undefined>): DiscoveredComposeProject[] {
  const byName = new Map<string, DiscoveredComposeProject>();
  for (const labels of labelSets) {
    const info = parseComposeInfo(labels);
    if (!info) continue;
    const entry = byName.get(info.project);
    if (entry) {
      entry.containerCount++;
    } else {
      byName.set(info.project, {
        name: info.project,
        configFiles: info.configFiles,
        workingDir: info.workingDir,
        containerCount: 1,
      });
    }
  }
  return [...byName.values()];
}

const INSPECT_BATCH = 100;

/**
 * Discover every compose stack known to Docker (running or stopped) from the
 * `com.docker.compose.*` labels on its containers. Returns an empty list when
 * Docker is unreachable.
 */
export async function listComposeStacks(): Promise<DiscoveredComposeProject[]> {
  try {
    const { stdout: idsOut } = await execFileAsync('docker', ['ps', '-a', '--format', '{{.ID}}']);
    const ids = idsOut.split('\n').map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) return [];

    const labelSets: Array<Record<string, string> | null> = [];
    for (let i = 0; i < ids.length; i += INSPECT_BATCH) {
      const batch = ids.slice(i, i + INSPECT_BATCH);
      const { stdout } = await execFileAsync('docker', ['inspect', '--format', '{{json .Config.Labels}}', ...batch]);
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        try { labelSets.push(JSON.parse(line) as Record<string, string>); } catch { labelSets.push(null); }
      }
    }
    return groupComposeProjects(labelSets);
  } catch {
    return [];
  }
}

export interface StackMatchQuery {
  /** Compose project name recorded on the container labels, if known. */
  composeProject: string | null;
  /** Path currently stored by Homer — never returned as a suggestion. */
  storedPath: string;
  /** Compose project to ignore (Homer's own stack). */
  excludeProject?: string | null;
  /** Config files that must never be suggested (other managed projects). */
  excludePaths?: Iterable<string>;
}

/**
 * Pick the config file a moved external project now lives at, using the stacks
 * Docker knows about. Matches by compose project name first, then by compose
 * file basename when the project name is unknown. Pure selection — the caller
 * decides whether the returned path is actually readable.
 */
export function matchStackPath(stacks: DiscoveredComposeProject[], query: StackMatchQuery): string | null {
  const exclude = new Set(query.excludePaths ?? []);
  const candidates = stacks.filter(s => s.name !== query.excludeProject);
  // Name match is authoritative; the basename fallback only applies when we
  // have no project name to match on, to avoid suggesting an unrelated stack
  // that merely happens to use a docker-compose.yml.
  const ordered = query.composeProject
    ? candidates.filter(s => s.name === query.composeProject)
    : candidates.filter(s => s.configFiles.some(f => path.basename(f) === path.basename(query.storedPath)));
  for (const stack of ordered) {
    for (const file of stack.configFiles) {
      if (file !== query.storedPath && !exclude.has(file)) return file;
    }
  }
  return null;
}

let ownComposeInfo: ComposeInfo | null | undefined;

/**
 * Compose provenance of the stack Homer itself runs in. Inside Docker,
 * HOSTNAME is the container id (same trick as the self-updater). Resolves to
 * null outside a compose-managed container (dev mode). Cached for the process
 * lifetime — Homer's own stack cannot change while it runs.
 */
export function getOwnComposeInfo(): Promise<ComposeInfo | null> {
  if (ownComposeInfo !== undefined) return Promise.resolve(ownComposeInfo);
  const hostname = process.env.HOSTNAME;
  if (!hostname) {
    ownComposeInfo = null;
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const child = spawn('docker', ['inspect', hostname, '--format', '{{json .Config.Labels}}'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.on('error', () => { ownComposeInfo = null; resolve(null); });
    child.on('close', () => {
      try {
        ownComposeInfo = parseComposeInfo(JSON.parse(stdout.trim()));
      } catch {
        ownComposeInfo = null;
      }
      resolve(ownComposeInfo);
    });
  });
}

let ownImage: string | null | undefined;

/** Image Homer's own container runs — used to spawn helper containers without pulling anything. */
export function getOwnImage(): Promise<string | null> {
  if (ownImage !== undefined) return Promise.resolve(ownImage);
  const hostname = process.env.HOSTNAME;
  if (!hostname) {
    ownImage = null;
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const child = spawn('docker', ['inspect', hostname, '--format', '{{.Config.Image}}'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.on('error', () => { ownImage = null; resolve(null); });
    child.on('close', (code) => {
      ownImage = code === 0 && stdout.trim() ? stdout.trim() : null;
      resolve(ownImage);
    });
  });
}

/**
 * Find lines of a compose file that reference relative paths (./x or ../x).
 * Relative paths resolve against the compose project directory, which only
 * stays correct for external projects because of the identical-path mount —
 * absolute paths are unambiguous and preferred.
 */
export function findRelativePathRefs(composeYaml: string): string[] {
  const refs: string[] = [];
  for (const raw of composeYaml.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/(^-\s*|:\s+)(['"]?)\.\.?\//.test(line)) refs.push(line);
  }
  return refs;
}
