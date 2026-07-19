import path from 'path';

/**
 * The compose project name passed to `docker compose -p`. Adopted external
 * stacks keep the name recorded on their containers' labels; Homer-created
 * projects fall back to compose's own default: the compose file's directory
 * name.
 */
export function getComposeProjectName(project: { path: string; compose_project?: string | null }): string {
  return project.compose_project || path.basename(path.dirname(project.path));
}

/**
 * Tell the user which volume to add to Homer's own docker-compose.yml so a
 * compose file outside the data mount becomes readable. The mount must use the
 * identical host and container path so bind mounts declared in that compose
 * file still resolve on the host.
 */
export function getMountHint(composePath: string): string {
  const dir = path.dirname(composePath);
  return `Compose file not accessible from Homer's container. To enable full management, add this volume to Homer's docker-compose.yml (identical host and container path) and restart Homer:\n  - ${dir}:${dir}`;
}
