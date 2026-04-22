import { randomUUID } from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getLocalInstance } from '../services/instance.js';
import {
  sessionQueries,
  peerQueries,
  pairingQueries,
} from '../db/index.js';
import {
  sixDigitCode,
  generateSecret,
  verifySignature,
  loadLocalRootCa,
  peerFetch,
} from '../services/peers.js';
import { exportLocalCa, importCa } from '../services/caddy.js';

const PAIRING_TTL_MS = 5 * 60 * 1000;

function requireAuth(request: FastifyRequest, reply: FastifyReply): boolean {
  const token = request.headers.authorization?.replace('Bearer ', '');
  const session = token ? sessionQueries.getByToken(token) : null;
  if (!session) {
    reply.status(401).send({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function verifyPeerHmac(request: FastifyRequest, reply: FastifyReply, sharedSecret: string): boolean {
  const timestamp = Number(request.headers['x-peer-timestamp']);
  const signature = request.headers['x-peer-signature'] as string | undefined;
  if (!signature || !verifySignature(sharedSecret, JSON.stringify(request.body) ?? '', timestamp, signature)) {
    reply.status(401).send({ error: 'Invalid peer signature' });
    return false;
  }
  return true;
}

export async function instancesRoutes(fastify: FastifyInstance) {

  // ── Public self-info ──────────────────────────────────────────────────────
  fastify.get('/api/instances/self', async () => {
    const instance = getLocalInstance();
    return {
      uuid: instance.uuid,
      name: instance.name,
      version: instance.version,
      url: instance.url,
    };
  });

  // ── Paired peers list ─────────────────────────────────────────────────────
  fastify.get('/api/instances', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const peers = peerQueries.getAll().map(p => ({
      uuid: p.peer_uuid,
      name: p.peer_name,
      url: p.peer_url,
      status: p.status,
      paired_at: p.paired_at,
      last_seen: p.last_seen,
    }));
    return { peers };
  });

  // ── Pairing: list pending received requests (shown on B's UI) ─────────────
  fastify.get('/api/instances/pair/pending', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    pairingQueries.cleanExpired();
    const pending = pairingQueries.getPendingReceived().map(r => ({
      id: r.id,
      peer_uuid: r.peer_uuid,
      peer_name: r.peer_name,
      peer_url: r.peer_url,
      expires_at: r.expires_at,
    }));
    return { pending };
  });

  // ── Pairing: initiate (A contacts B, gets back request_id + local code) ───
  fastify.post('/api/instances/pair/initiate', async (request, reply) => {
    if (!requireAuth(request, reply)) return;

    const { url } = request.body as { url?: string };
    if (!url || typeof url !== 'string') {
      return reply.status(400).send({ error: 'Missing peer URL' });
    }

    const local = getLocalInstance();
    const sharedSecret = generateSecret();
    const localCode = sixDigitCode();

    const helloResult = await peerFetch<{
      to_uuid: string;
      to_name: string;
      to_url: string | null;
      ca: string | null;
    }>(url, '/api/instances/_peer/pair/hello', {
      method: 'POST',
      body: {
        from_uuid: local.uuid,
        from_name: local.name,
        from_url: local.url,
        local_code: localCode,
        shared_secret: sharedSecret,
      },
    });

    if (!helloResult.ok || !helloResult.data) {
      return reply.status(502).send({ error: helloResult.error ?? 'Pair injoignable' });
    }

    const { to_uuid, to_name, to_url, ca: peerCa } = helloResult.data;

    if (peerQueries.getByUuid(to_uuid)) {
      return reply.status(409).send({ error: 'Cette instance est déjà appairée' });
    }

    const requestId = randomUUID();
    pairingQueries.create({
      id: requestId,
      direction: 'initiated',
      peer_uuid: to_uuid,
      peer_name: to_name,
      peer_url: to_url ?? url,
      peer_ca: peerCa,
      local_code: localCode,
      remote_code: null,
      shared_secret: sharedSecret,
      expires_at: Date.now() + PAIRING_TTL_MS,
    });

    return {
      request_id: requestId,
      local_code: localCode,
      peer_name: to_name,
      peer_uuid: to_uuid,
    };
  });

  // ── Pairing: poll approval status (A polls while waiting for B to approve) ─
  fastify.get('/api/instances/pair/status/:id', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };

    pairingQueries.cleanExpired();
    const req = pairingQueries.getById(id);
    if (!req || req.direction !== 'initiated') {
      return { status: 'expired' };
    }

    const local = getLocalInstance();
    const statusResult = await peerFetch<{
      status: string;
      peer_name?: string;
      ca?: string | null;
    }>(
      req.peer_url!,
      '/api/instances/_peer/pair/status',
      {
        peerCa: req.peer_ca,
        sharedSecret: req.shared_secret,
        senderUuid: local.uuid,
        timeoutMs: 5000,
      }
    );

    if (!statusResult.ok || !statusResult.data) {
      return { status: 'pending' };
    }

    if (statusResult.data.status === 'approved') {
      const bCa = statusResult.data.ca ?? req.peer_ca;
      peerQueries.upsert({
        peer_uuid: req.peer_uuid!,
        peer_name: req.peer_name!,
        peer_url: req.peer_url!,
        peer_ca: bCa,
        shared_secret: req.shared_secret,
        paired_at: Date.now(),
        status: 'online',
      });
      pairingQueries.delete(req.id);

      const localCa = await loadLocalRootCa();
      const ca_same = !!bCa && !!localCa && bCa.trim() === localCa.trim();
      return { status: 'approved', peer_name: req.peer_name, peer_uuid: req.peer_uuid, ca_same };
    }

    return { status: statusResult.data.status ?? 'pending' };
  });

  // ── Pairing: approve a received request (B's admin enters A's code) ────────
  fastify.post('/api/instances/pair/approve/:id', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const { entered_code } = request.body as { entered_code?: string };
    if (!entered_code) return reply.status(400).send({ error: 'entered_code required' });

    pairingQueries.cleanExpired();
    const req = pairingQueries.getById(id);
    if (!req || req.direction !== 'received') {
      return reply.status(404).send({ error: 'Demande introuvable ou expirée' });
    }
    if (entered_code !== req.remote_code) {
      return reply.status(400).send({ error: 'Code incorrect' });
    }

    peerQueries.upsert({
      peer_uuid: req.peer_uuid!,
      peer_name: req.peer_name!,
      peer_url: req.peer_url ?? '',
      peer_ca: null,
      shared_secret: req.shared_secret,
      paired_at: Date.now(),
      status: 'online',
    });
    pairingQueries.delete(req.id);

    return { success: true, peer_name: req.peer_name, peer_uuid: req.peer_uuid };
  });

  // ── Pairing: cancel a pending request ────────────────────────────────────
  fastify.delete('/api/instances/pair/:id', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    pairingQueries.delete(id);
    return { success: true };
  });

  // ── Unpair an existing peer ───────────────────────────────────────────────
  fastify.delete('/api/instances/:uuid', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { uuid } = request.params as { uuid: string };
    const peer = peerQueries.getByUuid(uuid);
    if (!peer) return reply.status(404).send({ error: 'Pair introuvable' });

    const local = getLocalInstance();
    await peerFetch(peer.peer_url, '/api/instances/_peer/unpair', {
      method: 'POST',
      body: { from_uuid: local.uuid },
      peerCa: peer.peer_ca,
      sharedSecret: peer.shared_secret,
      timeoutMs: 5000,
    }).catch(() => {});

    peerQueries.delete(uuid);
    return { success: true };
  });

  // ── Peer-to-peer: hello (B receives handshake from A) ────────────────────
  fastify.post('/api/instances/_peer/pair/hello', async (request, reply) => {
    const body = request.body as {
      from_uuid?: string;
      from_name?: string;
      from_url?: string | null;
      local_code?: string;
      shared_secret?: string;
    };

    if (!body.from_uuid || !body.from_name || !body.local_code || !body.shared_secret) {
      return reply.status(400).send({ error: 'Missing required fields' });
    }

    if (peerQueries.getByUuid(body.from_uuid)) {
      return reply.status(409).send({ error: 'Already paired' });
    }

    const requestId = randomUUID();
    pairingQueries.cleanExpired();
    pairingQueries.create({
      id: requestId,
      direction: 'received',
      peer_uuid: body.from_uuid,
      peer_name: body.from_name,
      peer_url: body.from_url ?? null,
      peer_ca: null,
      local_code: sixDigitCode(),
      remote_code: body.local_code,
      shared_secret: body.shared_secret,
      expires_at: Date.now() + PAIRING_TTL_MS,
    });

    (fastify as any).broadcast?.({ type: 'pairing_request', peer_name: body.from_name, peer_uuid: body.from_uuid, peer_url: body.from_url ?? null });

    const local = getLocalInstance();
    const ca = await loadLocalRootCa();
    return {
      to_uuid: local.uuid,
      to_name: local.name,
      to_url: local.url,
      ca,
    };
  });

  // ── Peer-to-peer: approval status (B responds to A's poll) ───────────────
  fastify.get('/api/instances/_peer/pair/status', async (request, reply) => {
    const peerUuid = request.headers['x-peer-uuid'] as string | undefined;
    if (!peerUuid) return reply.status(401).send({ error: 'Missing X-Peer-Uuid' });

    // Accept HMAC from pairing request (pending) or established peer (just approved)
    const pairingReq = pairingQueries.getByPeerUuid(peerUuid);
    const peer = peerQueries.getByUuid(peerUuid);
    const secret = pairingReq?.shared_secret ?? peer?.shared_secret;
    if (!secret || !verifyPeerHmac(request, reply, secret)) return;

    if (peer) {
      const ca = await loadLocalRootCa();
      return { status: 'approved', ca };
    }
    if (pairingReq) {
      return { status: 'pending' };
    }
    return { status: 'expired' };
  });

  // ── Peer-to-peer: unpair notification (HMAC auth) ─────────────────────────
  fastify.post('/api/instances/_peer/unpair', async (request, reply) => {
    const body = request.body as { from_uuid?: string };
    if (!body.from_uuid) return reply.status(400).send({ error: 'Missing from_uuid' });

    const peer = peerQueries.getByUuid(body.from_uuid);
    if (!peer) return reply.status(404).send({ error: 'Unknown peer' });

    if (!verifyPeerHmac(request, reply, peer.shared_secret)) return;

    peerQueries.delete(body.from_uuid);
    return { success: true };
  });

  // ── Peer-to-peer: export local CA cert + key (HMAC auth) ─────────────────
  fastify.post('/api/instances/_peer/ca-export', async (request, reply) => {
    const peerUuid = request.headers['x-peer-uuid'] as string | undefined;
    const peer = peerQueries.getByUuid(peerUuid ?? '');
    if (!peer || !verifyPeerHmac(request, reply, peer.shared_secret)) return;

    const ca = await exportLocalCa();
    if (!ca) return reply.status(503).send({ error: 'CA unavailable' });
    return ca;
  });

  // ── Peer-to-peer: new instance registers itself via federation setup flow ───
  fastify.post('/api/instances/_peer/federation-join', async (request, reply) => {
    // Accept either bearer token auth or HMAC peer auth
    const token = request.headers.authorization?.replace('Bearer ', '');
    const session = token ? sessionQueries.getByToken(token) : null;
    const peerUuid = request.headers['x-peer-uuid'] as string | undefined;
    const peerEntry = peerUuid ? peerQueries.getByUuid(peerUuid) : null;
    const timestamp = Number(request.headers['x-peer-timestamp']);
    const signature = request.headers['x-peer-signature'] as string | undefined;

    let authenticated = false;
    if (session) {
      authenticated = true;
    } else if (peerEntry && signature && verifySignature(peerEntry.shared_secret, JSON.stringify(request.body) ?? '', timestamp, signature)) {
      authenticated = true;
    }

    if (!authenticated) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const body = (request.body as {
      peer_uuid?: string;
      peer_name?: string;
      peer_url?: string;
      peer_ca?: string;
      shared_secret?: string;
    });
    if (!body.peer_uuid || !body.peer_name || !body.shared_secret) {
      return reply.status(400).send({ error: 'peer_uuid, peer_name and shared_secret are required' });
    }

    peerQueries.upsert({
      peer_uuid: body.peer_uuid,
      peer_name: body.peer_name,
      peer_url: body.peer_url ?? '',
      peer_ca: body.peer_ca ?? null,
      shared_secret: body.shared_secret,
      paired_at: Date.now(),
      status: 'online',
    });

    // Return our peer list so the newcomer can register with all of them
    const ourPeers = peerQueries.getAll().map(p => ({
      peer_uuid: p.peer_uuid,
      peer_name: p.peer_name,
      peer_url: p.peer_url,
      peer_ca: p.peer_ca,
      shared_secret: p.shared_secret,
    }));

    return { success: true, peers: ourPeers };
  });

  // ── Adopt a paired peer's CA on this instance ─────────────────────────────
  fastify.post('/api/instances/pair/adopt-ca', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { peer_uuid } = request.body as { peer_uuid?: string };
    if (!peer_uuid) return reply.status(400).send({ error: 'peer_uuid required' });

    const peer = peerQueries.getByUuid(peer_uuid);
    if (!peer) return reply.status(404).send({ error: 'Peer not found' });

    const local = getLocalInstance();
    const caResult = await peerFetch<{ cert: string; key: string }>(
      peer.peer_url, '/api/instances/_peer/ca-export',
      { method: 'POST', body: {}, peerCa: peer.peer_ca, sharedSecret: peer.shared_secret, senderUuid: local.uuid }
    );

    if (!caResult.ok || !caResult.data?.cert || !caResult.data?.key) {
      return reply.status(502).send({ error: caResult.error ?? 'Could not fetch peer CA' });
    }

    const result = await importCa(caResult.data.cert, caResult.data.key);
    if (!result.success) return reply.status(500).send({ error: result.error });

    // Update stored peer_ca so the heartbeat uses the new CA after import
    peerQueries.upsert({
      peer_uuid: peer.peer_uuid,
      peer_name: peer.peer_name,
      peer_url: peer.peer_url,
      peer_ca: caResult.data.cert,
      shared_secret: peer.shared_secret,
      paired_at: peer.paired_at,
      status: peer.status ?? 'online',
    });

    return { success: true };
  });

  // ── Leave federation (unpair from all peers, become independent again) ─────
  fastify.post('/api/instances/leave', async (request, reply) => {
    if (!requireAuth(request, reply)) return;

    const peers = peerQueries.getAll();
    const local = getLocalInstance();

    for (const peer of peers) {
      await peerFetch(peer.peer_url, '/api/instances/_peer/unpair', {
        method: 'POST',
        body: { from_uuid: local.uuid },
        peerCa: peer.peer_ca,
        sharedSecret: peer.shared_secret,
        timeoutMs: 5000,
      }).catch(() => {});
    }

    peerQueries.deleteAll();
    return { success: true };
  });
}
