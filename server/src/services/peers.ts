import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { readFile, writeFile, unlink } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.NODE_ENV === 'production'
  ? '/app/data'
  : join(__dirname, '../../../data');
const CADDY_RO = process.env.NODE_ENV === 'production'
  ? '/app/caddy-data'
  : join(__dirname, '../../../data/caddy/data');

const CA_PATHS = [
  join(CADDY_RO, 'caddy/pki/authorities/local/root.crt'),
];

const SIGNATURE_MAX_SKEW_MS = 60_000;

// Resolve .local hostnames via the mDNS supervisor container (which runs with --network host
// and talks to the host's Avahi daemon via D-Bus). Communication is file-based IPC through
// the shared data volume. Falls back silently if the supervisor is not running.
async function resolveMdnsViaSupervisor(hostname: string, timeoutMs = 5000): Promise<string> {
  const id = randomBytes(4).toString('hex');
  const reqFile = join(DATA_DIR, `mdns-resolve-${id}.request`);
  const resFile = join(DATA_DIR, `mdns-resolve-${id}.result`);

  await writeFile(reqFile, hostname, 'utf-8');

  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 300));
      try {
        const ip = (await readFile(resFile, 'utf-8')).trim();
        await unlink(resFile).catch(() => {});
        if (ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
        if (ip) throw new Error(`mDNS returned non-IPv4 address for ${hostname}: ${ip}`);
        throw new Error(`Could not resolve ${hostname} via mDNS`);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
  } finally {
    await unlink(reqFile).catch(() => {});
    await unlink(resFile).catch(() => {});
  }
  throw new Error(`mDNS resolution timeout for ${hostname}`);
}

export function sixDigitCode(): string {
  return String(randomInt(100_000, 1_000_000));
}

export function generateSecret(): string {
  return randomBytes(32).toString('hex');
}

export function signPayload(secret: string, body: string, timestamp: number): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function verifySignature(secret: string, body: string, timestamp: number, signature: string): boolean {
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() - timestamp) > SIGNATURE_MAX_SKEW_MS) return false;
  const expected = signPayload(secret, body, timestamp);
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(signature, 'hex');
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

export async function loadLocalRootCa(): Promise<string | null> {
  for (const path of CA_PATHS) {
    try {
      return (await readFile(path)).toString('utf-8');
    } catch {}
  }
  return null;
}

export interface PeerFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  peerCa?: string | null;
  sharedSecret?: string | null;
  senderUuid?: string | null;
  timeoutMs?: number;
  bearerToken?: string | null;
}

export interface PeerFetchResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

export async function peerFetch<T = unknown>(
  peerUrl: string,
  path: string,
  options: PeerFetchOptions = {}
): Promise<PeerFetchResult<T>> {
  const url = new URL(path, peerUrl.endsWith('/') ? peerUrl : `${peerUrl}/`);
  const method = options.method ?? 'GET';
  const bodyString = options.body !== undefined ? JSON.stringify(options.body) : undefined;
  const timeoutMs = options.timeoutMs ?? 15_000;

  const reqHeaders: Record<string, string> = { Accept: 'application/json' };
  if (bodyString) {
    reqHeaders['Content-Type'] = 'application/json';
    reqHeaders['Content-Length'] = String(Buffer.byteLength(bodyString));
  }

  if (options.bearerToken) {
    reqHeaders['Authorization'] = `Bearer ${options.bearerToken}`;
  }

  if (options.senderUuid) {
    reqHeaders['X-Peer-Uuid'] = options.senderUuid;
  }

  if (options.sharedSecret) {
    const timestamp = Date.now();
    const signature = signPayload(options.sharedSecret, bodyString ?? '', timestamp);
    reqHeaders['X-Peer-Timestamp'] = String(timestamp);
    reqHeaders['X-Peer-Signature'] = signature;
  }

  // Resolve .local mDNS hostnames — Docker's DNS can't resolve them
  let connectHostname = url.hostname;
  const isLocalHostname = url.hostname.endsWith('.local');
  if (isLocalHostname) {
    try {
      connectHostname = await resolveMdnsViaSupervisor(url.hostname, Math.min(Math.floor(timeoutMs / 2), 5000));
    } catch {
      // leave connectHostname as-is; system DNS will fail with a clear message
    }
  }

  const resolved = isLocalHostname && connectHostname !== url.hostname;
  if (resolved) {
    reqHeaders['Host'] = url.port ? `${url.hostname}:${url.port}` : url.hostname;
  }

  return new Promise((resolve) => {
    const isHttps = url.protocol === 'https:';

    const agentOptions: https.AgentOptions = isHttps
      ? (options.peerCa
          ? { ca: options.peerCa }
          : { rejectUnauthorized: false })
      : {};

    const reqOptions: http.RequestOptions = {
      hostname: connectHostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: reqHeaders,
      ...(isHttps && resolved ? { servername: url.hostname } : {}),
      ...(isHttps ? { agent: new https.Agent(agentOptions) } : {}),
    };

    const transport = isHttps ? https : http;
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      req.destroy();
      resolve({ ok: false, status: 0, data: null, error: 'Request timeout' });
    }, timeoutMs);

    const req = transport.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        const text = Buffer.concat(chunks).toString('utf-8');
        let data: T | null = null;
        if (text) {
          const contentType = res.headers['content-type'] ?? '';
          if (!contentType || contentType.startsWith('application/json')) {
            try {
              data = JSON.parse(text) as T;
            } catch {
              resolve({ ok: false, status: res.statusCode ?? 0, data: null, error: 'Invalid JSON response' });
              return;
            }
          } else {
            data = text as unknown as T;
          }
        }
        const status = res.statusCode ?? 0;
        const ok = status >= 200 && status < 300;
        if (!ok) {
          const err = (data as { error?: string } | null)?.error ?? `HTTP ${status}`;
          resolve({ ok: false, status, data, error: err });
          return;
        }
        resolve({ ok: true, status, data });
      });
    });

    req.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ ok: false, status: 0, data: null, error: err.message });
    });

    if (bodyString) req.write(bodyString);
    req.end();
  });
}
