import { parseComposeInfo } from './container-recreate.js';

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
