/**
 * Safety constraints applied to every Caddy config Homer pushes — whether
 * generated, loaded from a saved override, or supplied verbatim by a user
 * through the raw-config editor.
 *
 * The admin API must stay reachable by Homer (cross-container, at
 * CADDY_ADMIN_URL) and origin-restricted. Letting a pushed config drop or widen
 * that restriction would either expose the admin API to other containers or
 * lock Homer out of Caddy entirely. We therefore always re-assert a safe admin
 * block instead of trusting the incoming one.
 */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const DEFAULT_ADMIN_LISTEN = '0.0.0.0:2019';

export function constrainCaddyConfig(config: unknown, adminOrigin: string): Record<string, unknown> {
  if (!isPlainObject(config)) {
    throw new Error('Caddy config must be a JSON object');
  }
  const admin = isPlainObject(config.admin) ? { ...config.admin } : {};
  admin.origins = [adminOrigin];
  if (typeof admin.listen !== 'string' || admin.listen.length === 0) {
    admin.listen = DEFAULT_ADMIN_LISTEN;
  }
  return { ...config, admin };
}
