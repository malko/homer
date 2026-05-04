import bcrypt from 'bcryptjs';
import http from 'http';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { readFile, readdir, rm } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { proxyHostQueries, settingQueries } from '../db/index.js';
import type { ProxyHost } from '../db/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL || 'http://localhost:2019';
const HOMER_DOMAIN = process.env.HOMER_DOMAIN || '';
const HOMER_PORT = process.env.PORT || '4000';

// Data dir — same logic as db/index.ts
const DATA_DIR = process.env.DATA_DIR ?? (process.env.NODE_ENV === 'production' ? '/app/data' : join(__dirname, '../../../data'));

// Homer's writable path into Caddy's data directory (via ./data volume mount)
const CADDY_DATA_WRITE = join(DATA_DIR, 'caddy/data');

// Read-only view from Homer (the :ro mount)
const CADDY_RO = process.env.NODE_ENV === 'production' ? '/app/caddy-data' : CADDY_DATA_WRITE;
const PKI_LOCAL_DIR  = join(CADDY_DATA_WRITE, 'caddy/pki/authorities/local');
const CA_CERT_PATH    = join(CADDY_RO, 'caddy/pki/authorities/local/root.crt');
const CA_KEY_PATH     = join(CADDY_DATA_WRITE, 'caddy/pki/authorities/local/root.key');

export async function exportLocalCa(): Promise<{ cert: string; key: string } | null> {
  try {
    const [cert, key] = await Promise.all([readFile(CA_CERT_PATH, 'utf-8'), readFile(CA_KEY_PATH, 'utf-8')]);
    return { cert, key };
  } catch {
    return null;
  }
}

export async function importCa(cert: string, key: string): Promise<{ success: boolean; error?: string }> {
  if (!cert.includes('-----BEGIN CERTIFICATE-----') || !key.includes('-----BEGIN')) {
    return { success: false, error: 'Invalid PEM format' };
  }
  try {
    // Write the adopted CA directly to Caddy's default PKI path.
    // Caddy will regenerate its intermediate certificate using the new root,
    // ensuring the entire chain (site cert → intermediate → root) is consistent.
    if (!existsSync(PKI_LOCAL_DIR)) mkdirSync(PKI_LOCAL_DIR, { recursive: true });
    writeFileSync(join(PKI_LOCAL_DIR, 'root.crt'), cert);
    writeFileSync(join(PKI_LOCAL_DIR, 'root.key'), key);

    // Remove the old intermediate so Caddy regenerates it signed by the new root
    await rm(join(PKI_LOCAL_DIR, 'intermediate.crt'), { force: true }).catch(() => {});
    await rm(join(PKI_LOCAL_DIR, 'intermediate.key'), { force: true }).catch(() => {});

    // Clear cached site certificates so Caddy re-issues them with the new chain
    const certStorageDir = join(CADDY_DATA_WRITE, 'caddy/certificates');
    try {
      const entries = await readdir(certStorageDir);
      await Promise.all(
        entries
          .filter(e => e === 'local' || e.startsWith('local-'))
          .map(e => rm(join(certStorageDir, e), { recursive: true, force: true }))
      );
    } catch { /* cert storage may not exist yet */ }

    // Clean up the legacy custom-ca directory from older versions
    await rm(join(CADDY_DATA_WRITE, 'custom-ca'), { recursive: true, force: true }).catch(() => {});

    return await pushConfig();
  } catch (err) {
    return { success: false, error: `${err}` };
  }
}

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

interface ParsedUpstream {
  dial: string;
  transport?: {
    protocol: 'http' | 'https';
    tls?: { insecure_skip_verify?: boolean };
  };
}

function parseUpstream(upstream: string): ParsedUpstream {
  if (upstream.startsWith('http://') || upstream.startsWith('https://')) {
    const url = new URL(upstream);
    const protocol = url.protocol === 'https:' ? 'https' : 'http';
    const port = url.port || (protocol === 'https' ? '443' : '80');
    const dial = `${url.hostname}:${port}`;
    if (protocol === 'https') {
      return { dial, transport: { protocol: 'http', tls: { insecure_skip_verify: true } } };
    }
    return { dial, transport: { protocol: 'http' } };
  }
  return { dial: upstream };
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

  const parsed = parseUpstream(host.upstream);
  const proxyHandler: Record<string, unknown> = {
    handler: 'reverse_proxy',
    upstreams: [{ dial: parsed.dial }],
  };
  if (parsed.transport) {
    proxyHandler.transport = parsed.transport;
  }
  handlers.push(proxyHandler);

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
        upstreams: [{ dial: `homer:${HOMER_PORT}` }],
      }],
      terminal: true,
    });
  } else {
    routes.push({
      match: [{ host: ['*'] }],
      handle: [{
        handler: 'reverse_proxy',
        upstreams: [{ dial: `homer:${HOMER_PORT}` }],
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

  const hasTls = tlsPolicies.length > 0;

  const servers: Record<string, unknown> = {};

  if (hasTls) {
    // Build set of domains allowed on HTTP (port 80)
    const httpAllowedDomains = new Set<string>();
    httpAllowedDomains.add('localhost');
    httpAllowedDomains.add('127.0.0.1');
    if (HOMER_DOMAIN) httpAllowedDomains.add(HOMER_DOMAIN);

    // Add proxy hosts with allow_http enabled
    for (const host of hosts) {
      if (host.allow_http) {
        httpAllowedDomains.add(host.domain);
      }
    }

    // HTTPS server on :443 - all domains
    const httpsRoutes: CaddyRoute[] = [...routes];

    // HTTP server on :80 - only allowed domains
    const httpRoutes: CaddyRoute[] = routes.filter(r => {
      const hosts = (r.match?.[0]?.host as string[]) || [];
      return hosts.some(h => httpAllowedDomains.has(h));
    });

    // Add localhost route at the beginning
    httpRoutes.unshift({
      match: [{ host: ['localhost', '127.0.0.1'] }],
      handle: [{
        handler: 'reverse_proxy',
        upstreams: [{ dial: `homer:${HOMER_PORT}` }],
      }],
      terminal: true,
    });

    servers.srv_https = {
      listen: [':443'],
      routes: httpsRoutes,
      automatic_https: { disable_redirects: true },
    };
    servers.srv_http = {
      listen: [':80'],
      routes: httpRoutes,
      automatic_https: { disable: true },
    };
  } else {
    // No TLS - HTTP only on :80
    servers.srv0 = {
      listen: [':80'],
      routes,
      automatic_https: { disable: true },
    };
  }

  const apps: Record<string, unknown> = { http: { servers } };
  if (hasTls) {
    apps.tls = { automation: { policies: tlsPolicies } };
  }
  const config: Record<string, unknown> = {
    admin: { listen: '0.0.0.0:2019', origins: [CADDY_ADMIN_URL] },
    apps,
  };

  return config;
}

export async function pushConfig(config?: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
  const payload = config || buildCaddyConfig();
  const maxRetries = 10;
  const retryDelay = 3000;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await caddyRequest('/load', 'POST', JSON.stringify(payload));
      if (res.status >= 200 && res.status < 300) {
        return { success: true };
      }
      return { success: false, error: `Caddy returned ${res.status}: ${res.body}` };
    } catch (err) {
      if (i < maxRetries - 1) {
        console.log(`[Caddy] Waiting for Caddy to be ready... (${i + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, retryDelay));
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
