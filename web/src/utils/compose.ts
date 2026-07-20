/**
 * Find lines of a compose file referencing relative paths (./x or ../x).
 * Mirrors the server-side detection (server/src/services/compose-discovery.ts):
 * relative paths resolve against the compose project directory as seen by the
 * process running compose, which makes bind mounts point somewhere unexpected
 * on the host when that directory is mounted at a different path.
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
