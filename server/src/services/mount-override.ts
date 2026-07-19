import path from 'path';
import type { ComposeInfo } from './container-recreate.js';

/**
 * Everything the UI needs to walk the user through mounting external stack
 * directories into Homer's container: a ready-to-paste compose override file
 * and the command that applies it.
 */
export interface MountGuide {
  /** Host directories that need an identical-path mount (sorted, unique). */
  dirs: string[];
  /** Where to create the override, next to Homer's own compose file. Null when Homer's own stack is unknown (dev mode). */
  overrideFile: string | null;
  /** Full YAML content of the override file. */
  overrideContent: string;
  /** Command applying the override (recreates Homer's container). Null when Homer's own stack is unknown. */
  upCommand: string | null;
  /** Homer's own compose files already include an override — complete it instead of creating it. */
  overrideExists: boolean;
}

// Base names compose auto-loads an override for when run without -f.
const AUTO_LOAD_BASENAMES = new Set(['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']);

function isOverrideFile(file: string): boolean {
  return /override\.ya?ml$/.test(path.basename(file));
}

export function buildMountGuide(dirs: string[], own: ComposeInfo | null): MountGuide {
  const uniqueDirs = [...new Set(dirs)].sort();
  const service = own?.service || 'homer';
  const volumeLines = uniqueDirs.map(dir => `      - ${dir}:${dir}`).join('\n');
  const overrideContent = `services:\n  ${service}:\n    volumes:\n${volumeLines}\n`;

  if (!own || own.configFiles.length === 0) {
    return { dirs: uniqueDirs, overrideFile: null, overrideContent, upCommand: null, overrideExists: false };
  }

  const existingOverride = own.configFiles.find(isOverrideFile);
  const overrideFile = existingOverride ?? path.join(path.dirname(own.configFiles[0]), 'docker-compose.override.yml');
  const cwd = own.workingDir ?? path.dirname(own.configFiles[0]);

  const autoLoads = own.configFiles.length === 1 && AUTO_LOAD_BASENAMES.has(path.basename(own.configFiles[0]));
  let upCommand: string;
  if (autoLoads) {
    // Compose picks up docker-compose.override.yml on its own.
    upCommand = `cd ${cwd} && docker compose up -d`;
  } else {
    const files = existingOverride ? own.configFiles : [...own.configFiles, overrideFile];
    upCommand = `cd ${cwd} && docker compose ${files.map(f => `-f ${f}`).join(' ')} up -d`;
  }

  return { dirs: uniqueDirs, overrideFile, overrideContent, upCommand, overrideExists: Boolean(existingOverride) };
}
