import bcrypt from 'bcryptjs';
import http from 'http';
import { proxyHostQueries, settingQueries } from '../db/index.js';
import type { ProxyHost } from '../db/index.js';

const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL || 'http://localhost:2019';
const HOMER_DOMAIN = process.env.HOMER_DOMAIN || '';
const HOMER_PORT = process.env.PORT || '4000';

const RFC1918_RANGES = ['192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12', '127.0.0.1/8', '::1'];

interface CaddyRoute {
  match?: Array<Record<string, unknown>>;
  handle: Array<Record<string, unknown>>;
  terminal?: boolean;
}

// Use http.request instead of fetch to avoid Node.js adding Sec-Fetch-* headers
// which trigger Caddy's origin checking and cause 403 errors.
function caddyRequest(path: string, method: string, body?: string): Promise<{ status: number; body: string }> {
  const url = new URL(path, CADDY_ADMIN_URL);
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'Origin': CADDY_ADMIN_URL,
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body).toString();
    }
    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function buildRouteForHost(host: ProxyHost): CaddyRoute {
  const matchers: Array<Record<string, unknown>> = [{ host: [host.domain] }];

  if (host.local_only) {
    matchers[0].remote_ip = { ranges: RFC1918_RANGES };
  }

  const handlers: Array<Record<string, unknown>> = [];

  if (host.basic_auth_user && host.basic_auth_password_hash) {
    handlers.push({
      handler: 'authentication',
      providers: {
        http_basic: {
          accounts: [{
            username: host.basic_auth_user,
            password: host.basic_auth_password_hash,
          }],
        },
      },
    });
  }

  handlers.push({
    handler: 'reverse_proxy',
    upstreams: [{ dial: host.upstream }],
  });

  return {
    match: matchers,
    handle: handlers,
    terminal: true,
  };
}

export function buildCaddyConfig(): Record<string, unknown> {
  const hosts = proxyHostQueries.getAll().filter(h => h.enabled);
  const routes: CaddyRoute[] = [];

  // Route for HOMER itself
  if (HOMER_DOMAIN) {
    routes.push({
      match: [{ host: [HOMER_DOMAIN] }],
      handle: [{
        handler: 'reverse_proxy',
        upstreams: [{ dial: `homelab-manager:${HOMER_PORT}` }],
      }],
      terminal: true,
    });
  }

  // Routes for proxy hosts
  for (const host of hosts) {
    routes.push(buildRouteForHost(host));
  }

  // Build TLS policies
  const internalDomains: string[] = [];
  const acmeDomains: string[] = [];

  if (HOMER_DOMAIN) internalDomains.push(HOMER_DOMAIN);

  for (const host of hosts) {
    if (host.tls_mode === 'acme') {
      acmeDomains.push(host.domain);
    } else {
      internalDomains.push(host.domain);
    }
  }

  const tlsPolicies: Array<Record<string, unknown>> = [];
  const rawCertLifetime = settingQueries.get('caddy_cert_lifetime');
  const certLifetimeMinutes = rawCertLifetime ? parseInt(rawCertLifetime, 10) : 10080;
  const certLifetime = `${certLifetimeMinutes}m`;

  if (internalDomains.length > 0) {
    tlsPolicies.push({
      subjects: internalDomains,
      issuers: [{ module: 'internal', lifetime: certLifetime }],
    });
  }
  if (acmeDomains.length > 0) {
    tlsPolicies.push({
      subjects: acmeDomains,
      issuers: [{ module: 'acme' }],
    });
  }

  const config: Record<string, unknown> = {
    admin: {
      listen: '0.0.0.0:2019',
      origins: [CADDY_ADMIN_URL],
    },
    apps: {
      http: {
        servers: {
          srv0: {
            listen: [':443', ':80'],
            routes,
          },
        },
      },
      ...(tlsPolicies.length > 0 ? {
        tls: {
          automation: {
            policies: tlsPolicies,
          },
        },
      } : {}),
    },
  };

  return config;
}

export async function pushConfig(config?: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
  const payload = config || buildCaddyConfig();
  const maxRetries = 3;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await caddyRequest('/load', 'POST', JSON.stringify(payload));
      if (res.status >= 200 && res.status < 300) {
        return { success: true };
      }
      return { success: false, error: `Caddy returned ${res.status}: ${res.body}` };
    } catch (err) {
      if (i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      return { success: false, error: `Cannot reach Caddy at ${CADDY_ADMIN_URL}: ${err}` };
    }
  }
  return { success: false, error: 'Unexpected error' };
}

export async function syncConfig(): Promise<{ success: boolean; error?: string }> {
  const override = settingQueries.get('caddy_config_override');
  if (override) {
    try {
      const config = JSON.parse(override);
      return pushConfig(config);
    } catch {
      // Invalid override, fall back to generated config
    }
  }
  return pushConfig();
}

export async function getRunningConfig(): Promise<Record<string, unknown> | null> {
  try {
    const res = await caddyRequest('/config/', 'GET');
    if (res.status === 200) {
      return JSON.parse(res.body) as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getCaddyStatus(): Promise<{ running: boolean; error?: string }> {
  try {
    const res = await caddyRequest('/config/', 'GET');
    return { running: res.status === 200 };
  } catch (err) {
    return { running: false, error: `${err}` };
  }
}

export async function hashBasicAuthPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function initCaddyConfig(): Promise<void> {
  const result = await syncConfig();
  if (result.success) {
    console.log('[Caddy] Configuration pushed successfully');
  } else {
    console.log(`[Caddy] Could not push config (Caddy may not be running): ${result.error}`);
  }
}
