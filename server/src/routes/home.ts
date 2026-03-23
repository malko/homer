import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { homeTileQueries, sessionQueries } from '../db/index.js';

const MAX_FAVICON_BYTES = 512 * 1024;

async function fetchWithTimeout(url: string): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function detectImageMime(buffer: ArrayBuffer): string | null {
  const b = new Uint8Array(buffer);
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return 'image/x-icon';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  const head = Buffer.from(buffer.slice(0, 128)).toString('utf8');
  if (head.trimStart().startsWith('<svg') || head.includes('<svg ')) return 'image/svg+xml';
  return null;
}

async function tryFetchImage(url: string): Promise<{ dataUri: string } | null> {
  const res = await fetchWithTimeout(url);
  if (!res || !res.ok) return null;

  const lengthHeader = res.headers.get('content-length');
  if (lengthHeader && parseInt(lengthHeader, 10) > MAX_FAVICON_BYTES) return null;

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_FAVICON_BYTES) return null;

  const declared = (res.headers.get('content-type') ?? '').split(';')[0].trim();

  // If declared mime is a known image type, trust it
  let mime: string | null = declared.startsWith('image/') ? declared : null;
  // Otherwise (or for application/octet-stream), sniff magic bytes
  if (!mime || mime === 'application/octet-stream') mime = detectImageMime(buffer);
  if (!mime) return null;

  const base64 = Buffer.from(buffer).toString('base64');
  return { dataUri: `data:${mime};base64,${base64}` };
}

async function findFaviconInHtml(serviceUrl: string): Promise<string | null> {
  const res = await fetchWithTimeout(serviceUrl);
  if (!res || !res.ok) return null;
  const ct = (res.headers.get('content-type') ?? '');
  if (!ct.includes('text/html')) return null;

  const html = await res.text();
  // Match <link rel="icon"|"shortcut icon"|"apple-touch-icon" href="...">
  // attribute order can vary so scan each <link> tag individually
  const linkRe = /<link([^>]+)>/gi;
  const relRe = /\brel=["']([^"']+)["']/i;
  const hrefRe = /\bhref=["']([^"']+)["']/i;
  const iconRels = new Set(['icon', 'shortcut icon', 'apple-touch-icon']);

  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const attrs = m[1];
    const relM = relRe.exec(attrs);
    if (!relM || !iconRels.has(relM[1].toLowerCase())) continue;
    const hrefM = hrefRe.exec(attrs);
    if (!hrefM) continue;
    try { return new URL(hrefM[1], serviceUrl).href; } catch {}
  }
  return null;
}

async function fetchFavicon(serviceUrl: string): Promise<{ dataUri: string } | null> {
  let base: URL;
  try { base = new URL(serviceUrl); } catch { return null; }

  // 1. Try the canonical /favicon.ico
  const direct = await tryFetchImage(new URL('/favicon.ico', base).href);
  if (direct) return direct;

  // 2. Parse the HTML page for <link rel="icon">
  const iconHref = await findFaviconInHtml(base.href);
  if (iconHref) return tryFetchImage(iconHref);

  return null;
}

const upsertTileSchema = z.object({
  display_name: z.string().max(100).nullable().optional(),
  icon: z.string().max(500000).nullable().optional(),
  icon_bg: z.string().max(50).nullable().optional(),
  card_bg: z.string().max(50).nullable().optional(),
  hidden: z.boolean().optional(),
});

export async function homeRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', async (request: FastifyRequest) => {
    const token = request.headers.authorization?.replace('Bearer ', '');
    const session = token ? sessionQueries.getByToken(token) : null;
    if (!session) throw { statusCode: 401, message: 'Unauthorized' };
  });

  fastify.get('/api/home/favicon', async (request, reply) => {
    const { url } = request.query as { url?: string };
    if (!url) return reply.status(400).send({ error: 'Missing url parameter' });

    try { new URL(url); } catch {
      return reply.status(400).send({ error: 'Invalid url' });
    }

    const result = await fetchFavicon(url);
    if (!result) return reply.status(404).send({ error: 'Favicon not found' });
    return result;
  });

  fastify.get('/api/home/tiles', async () => {
    return homeTileQueries.getAll();
  });

  fastify.put('/api/home/tiles/:projectId/:serviceKey', async (request, reply) => {
    const { projectId, serviceKey } = request.params as { projectId: string; serviceKey: string };
    const id = parseInt(projectId, 10);
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid project id' });

    const parsed = upsertTileSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body' });

    const body = parsed.data;
    const existing = homeTileQueries.getAll().find(t => t.project_id === id && t.service_key === serviceKey);

    homeTileQueries.upsert(
      id,
      serviceKey,
      body.display_name !== undefined ? body.display_name : (existing?.display_name ?? null),
      body.icon !== undefined ? body.icon : (existing?.icon ?? null),
      body.icon_bg !== undefined ? body.icon_bg : (existing?.icon_bg ?? null),
      body.card_bg !== undefined ? body.card_bg : (existing?.card_bg ?? null),
      body.hidden !== undefined ? (body.hidden ? 1 : 0) : (existing?.hidden ?? 0),
    );

    return { success: true };
  });
}
