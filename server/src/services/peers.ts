import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { createSocket } from 'dgram';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CADDY_RO = process.env.NODE_ENV === 'production'
  ? '/app/caddy-data'
  : join(__dirname, '../../../data/caddy/data');

const CA_PATHS = [
  join(CADDY_RO, 'custom-ca/root.crt'),
  join(CADDY_RO, 'caddy/pki/authorities/local/root.crt'),
];

const SIGNATURE_MAX_SKEW_MS = 60_000;

function encodeDnsName(hostname: string): Buffer {
  const parts = hostname.split('.');
  const bufs = parts.map(part => Buffer.concat([Buffer.from([part.length]), Buffer.from(part, 'ascii')]));
  return Buffer.concat([...bufs, Buffer.from([0])]);
}

function buildMdnsQuery(hostname: string): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(Math.floor(Math.random() * 65536), 0); // transaction ID
  header.writeUInt16BE(0x0000, 2); // flags: standard query
  header.writeUInt16BE(1, 4);      // QDCOUNT = 1
  // ANCOUNT, NSCOUNT, ARCOUNT = 0 (already zeroed)
  const qtype_qclass = Buffer.alloc(4);
  qtype_qclass.writeUInt16BE(1, 0);      // QTYPE = A
  qtype_qclass.writeUInt16BE(0x8001, 2); // QCLASS = QU bit + IN
  return Buffer.concat([header, encodeDnsName(hostname), qtype_qclass]);
}

function skipDnsName(buf: Buffer, offset: number): number {
  while (offset < buf.length) {
    const len = buf[offset];
    if (len === 0) return offset + 1;
    if ((len & 0xc0) === 0xc0) return offset + 2; // compressed pointer
    offset += 1 + len;
  }
  return offset;
}

function parseMdnsResponse(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  const anCount = buf.readUInt16BE(6);
  if (anCount === 0) return null;
  let offset = 12;
  // skip question section
  const qdCount = buf.readUInt16BE(4);
  for (let i = 0; i < qdCount; i++) {
    offset = skipDnsName(buf, offset);
    offset += 4; // QTYPE + QCLASS
  }
  // parse answer section
  for (let i = 0; i < anCount; i++) {
    offset = skipDnsName(buf, offset);
    if (offset + 10 > buf.length) break;
    const type = buf.readUInt16BE(offset);
    const rdlength = buf.readUInt16BE(offset + 8);
    offset += 10;
    if (type === 1 && rdlength === 4 && offset + 4 <= buf.length) {
      return `${buf[offset]}.${buf[offset + 1]}.${buf[offset + 2]}.${buf[offset + 3]}`;
    }
    offset += rdlength;
  }
  return null;
}

function resolveMdnsLocal(hostname: string, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    const query = buildMdnsQuery(hostname);
    let done = false;

    const finish = (err?: Error, ip?: string) => {
      if (done) return;
      done = true;
      try { socket.close(); } catch {}
      if (ip) resolve(ip);
      else reject(err ?? new Error(`mDNS failed for ${hostname}`));
    };

    const timer = setTimeout(() => finish(new Error(`mDNS timeout resolving ${hostname}`)), timeoutMs);

    socket.on('message', (msg) => {
      const ip = parseMdnsResponse(msg);
      if (ip) { clearTimeout(timer); finish(undefined, ip); }
    });

    socket.on('error', (err) => { clearTimeout(timer); finish(err); });

    socket.bind(5353, () => {
      try { socket.addMembership('224.0.0.251'); } catch {}
      socket.send(query, 0, query.length, 5353, '224.0.0.251', (err) => {
        if (err) { clearTimeout(timer); finish(err); }
      });
    });
  });
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
      connectHostname = await resolveMdnsLocal(url.hostname, Math.min(Math.floor(timeoutMs / 3), 3000));
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
