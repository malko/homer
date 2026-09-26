import path from 'path';

export type ExternalPathValidation = { ok: true } | { ok: false; error: string };

/**
 * Validate a user-supplied compose file path for an adopted external project.
 * Mirrors the guard rails of the import route so a repaired path cannot point
 * inside Homer's own data dir or at Homer's own stack.
 */
export function validateExternalComposePath(
  composePath: string,
  opts: { projectsDir: string; ownConfigFiles: string[] },
): ExternalPathValidation {
  if (!path.isAbsolute(composePath)) {
    return { ok: false, error: 'Compose file path must be absolute' };
  }
  if (composePath === opts.projectsDir || composePath.startsWith(opts.projectsDir + path.sep)) {
    return { ok: false, error: "This compose file lives in Homer's projects directory — it is already managed" };
  }
  if (opts.ownConfigFiles.includes(composePath)) {
    return { ok: false, error: 'This is the stack Homer itself runs in — it cannot be managed' };
  }
  return { ok: true };
}
