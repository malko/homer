import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { readFile } from 'fs/promises';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

const CA_PATH = '/app/caddy-data/caddy/pki/authorities/local/root.crt';
const SIGNATURE_MAX_SKEW_MS = 60_000;

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
  try {
    const buf = await readFile(CA_PATH);
    return buf.toString('utf-8');
  } catch {
    return null;
  }
}

export interface PeerFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  peerCa?: string | null;
  sharedSecret?: string | null;
  senderUuid?: string | null;
  timeoutMs?: number;
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

  if (options.senderUuid) {
    reqHeaders['X-Peer-Uuid'] = options.senderUuid;
  }

  if (options.sharedSecret) {
    const timestamp = Date.now();
    const signature = signPayload(options.sharedSecret, bodyString ?? '', timestamp);
    reqHeaders['X-Peer-Timestamp'] = String(timestamp);
    reqHeaders['X-Peer-Signature'] = signature;
  }

  return new Promise((resolve) => {
    const isHttps = url.protocol === 'https:';

    const agentOptions: https.AgentOptions = isHttps
      ? (options.peerCa
          ? { ca: options.peerCa }
          : { rejectUnauthorized: false })
      : {};

    const reqOptions: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: reqHeaders,
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
          try {
            data = JSON.parse(text) as T;
          } catch {
            resolve({ ok: false, status: res.statusCode ?? 0, data: null, error: 'Invalid JSON response' });
            return;
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
