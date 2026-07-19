import { join } from 'path';

const DOCKER_DATA_DIR = '/app/data';

/**
 * Remap a stored host path to the current data directory so a database can move
 * between machines/locations (or in/out of Docker).
 *
 * The cross-location remap only triggers when the path clearly points inside
 * Homer's own `…/data/projects/` layout, anchored on the LAST occurrence. This
 * avoids rewriting unrelated paths that merely contain a `data` segment
 * (e.g. `/home/user/data/app`).
 */
export function normalizePath(p: string | null, dataDir: string, dockerDataDir: string = DOCKER_DATA_DIR): string | null {
  if (!p) return p;
  // Already under the current data dir — nothing to do.
  if (p === dataDir || p.startsWith(dataDir + '/')) return p;
  // Docker prefix.
  if (p === dockerDataDir || p.startsWith(dockerDataDir + '/')) {
    return join(dataDir, p.slice(dockerDataDir.length));
  }
  // A data dir from another machine/location, identified by Homer's own
  // projects layout.
  const PROJECTS_MARKER = '/data/projects/';
  const idx = p.lastIndexOf(PROJECTS_MARKER);
  if (idx !== -1) {
    return join(dataDir, p.slice(idx + '/data/'.length));
  }
  return p;
}

/**
 * Apply path normalization to a project row. External projects are exempt:
 * their compose files live outside the data dir and their stored paths are
 * host-truth — remapping one that happens to contain a `/data/projects/`
 * segment would silently break it.
 */
export function normalizeProjectPaths<T extends { path: string; env_path: string | null; external: number }>(project: T, dataDir: string): T {
  if (project.external) return project;
  return {
    ...project,
    path: normalizePath(project.path, dataDir) ?? project.path,
    env_path: normalizePath(project.env_path, dataDir),
  };
}
