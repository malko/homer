import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { homeTileQueries, externalTileQueries, sessionQueries, proxyHostQueries, proxyTileQueries } from '../db/index.js';

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

  let mime: string | null = declared.startsWith('image/') ? declared : null;
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

function resolveUpstreamUrl(serviceUrl: string): string {
  let parsed: URL;
  try { parsed = new URL(serviceUrl); } catch { return serviceUrl; }

  // If the domain matches a Caddy proxy host, use the upstream directly (avoids TLS issues)
  const hosts = proxyHostQueries.getAll();
  const match = hosts.find(h => h.domain === parsed.hostname);
  if (match) {
    return `http://${match.upstream}`;
  }
  return serviceUrl;
}

async function fetchFavicon(serviceUrl: string): Promise<{ dataUri: string } | null> {
  const resolvedUrl = resolveUpstreamUrl(serviceUrl);
  let base: URL;
  try { base = new URL(resolvedUrl); } catch { return null; }

  const direct = await tryFetchImage(new URL('/favicon.ico', base).href);
  if (direct) return direct;

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

const externalTileSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  icon: z.string().max(500000).nullable().optional(),
  icon_bg: z.string().max(50).nullable().optional(),
  card_bg: z.string().max(50).nullable().optional(),
  hidden: z.boolean().optional(),
});

const orderSchema = z.object({
  items: z.array(z.union([
    z.object({ type: z.literal('tile'), projectId: z.number(), serviceKey: z.string(), sortOrder: z.number() }),
    z.object({ type: z.literal('external'), id: z.number(), sortOrder: z.number() }),
    z.object({ type: z.literal('proxy-tile'), proxyHostId: z.number(), sortOrder: z.number() }),
  ])),
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
    return {
      overrides: homeTileQueries.getAll(),
      external: externalTileQueries.getAll(),
      proxyOverrides: proxyTileQueries.getAll(),
    };
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

  fastify.post('/api/home/order', async (request, reply) => {
    const parsed = orderSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body' });

    const tileItems = parsed.data.items
      .filter(i => i.type === 'tile') as Array<{ type: 'tile'; projectId: number; serviceKey: string; sortOrder: number }>;
    const extItems = parsed.data.items
      .filter(i => i.type === 'external') as Array<{ type: 'external'; id: number; sortOrder: number }>;
    const proxyItems = parsed.data.items
      .filter(i => i.type === 'proxy-tile') as Array<{ type: 'proxy-tile'; proxyHostId: number; sortOrder: number }>;

    if (tileItems.length > 0) {
      homeTileQueries.setOrderBatch(tileItems.map(i => ({ projectId: i.projectId, serviceKey: i.serviceKey, sortOrder: i.sortOrder })));
    }
    if (extItems.length > 0) {
      externalTileQueries.setOrderBatch(extItems.map(i => ({ id: i.id, sortOrder: i.sortOrder })));
    }
    if (proxyItems.length > 0) {
      proxyTileQueries.setOrderBatch(proxyItems.map(i => ({ proxyHostId: i.proxyHostId, sortOrder: i.sortOrder })));
    }

    return { success: true };
  });

  // ─── Standalone proxy host tile overrides ─────────────────────────────────

  fastify.put('/api/home/proxy-tiles/:proxyHostId', async (request, reply) => {
    const { proxyHostId } = request.params as { proxyHostId: string };
    const id = parseInt(proxyHostId, 10);
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid proxy host id' });

    const parsed = upsertTileSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body' });

    const body = parsed.data;
    const existing = proxyTileQueries.getAll().find(t => t.proxy_host_id === id);

    proxyTileQueries.upsert(
      id,
      body.display_name !== undefined ? body.display_name : (existing?.display_name ?? null),
      body.icon !== undefined ? body.icon : (existing?.icon ?? null),
      body.icon_bg !== undefined ? body.icon_bg : (existing?.icon_bg ?? null),
      body.card_bg !== undefined ? body.card_bg : (existing?.card_bg ?? null),
      body.hidden !== undefined ? (body.hidden ? 1 : 0) : (existing?.hidden ?? 0),
    );

    return { success: true };
  });

  // ─── External tiles ───────────────────────────────────────────────────────

  fastify.post('/api/home/external', async (request, reply) => {
    const parsed = externalTileSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body' });

    const body = parsed.data;
    const result = externalTileQueries.create(
      body.name,
      body.url,
      body.icon ?? null,
      body.icon_bg ?? null,
      body.card_bg ?? null,
      body.hidden ? 1 : 0,
      null,
    );

    return { success: true, id: result.id };
  });

  fastify.put('/api/home/external/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const extId = parseInt(id, 10);
    if (isNaN(extId)) return reply.status(400).send({ error: 'Invalid id' });

    const parsed = externalTileSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body' });

    const body = parsed.data;
    externalTileQueries.update(
      extId,
      body.name,
      body.url,
      body.icon ?? null,
      body.icon_bg ?? null,
      body.card_bg ?? null,
      body.hidden ? 1 : 0,
    );

    return { success: true };
  });

  fastify.delete('/api/home/external/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const extId = parseInt(id, 10);
    if (isNaN(extId)) return reply.status(400).send({ error: 'Invalid id' });

    externalTileQueries.delete(extId);
    return { success: true };
  });
}
