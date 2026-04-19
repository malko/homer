import { randomUUID } from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { getLocalInstance } from '../services/instance.js';
import { discoverPeers } from '../services/mdns.js';
import {
  sessionQueries,
  peerQueries,
  pairingQueries,
  userQueries,
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

type PairingRequestRow = import('../db/index.js').PairingRequest;

async function finalizePairing(
  req: PairingRequestRow,
  localUuid: string,
  localCa: string | null,
  reply: FastifyReply,
  conflictResolutions?: Array<{ username: string; home_instance_uuid: string }>,
) {
  const finalizeResult = await peerFetch<{ success: boolean }>(
    req.peer_url!,
    '/api/instances/_peer/pair/finalize',
    {
      method: 'POST',
      body: { from_uuid: localUuid, local_code: req.local_code, shared_secret: req.shared_secret, ca: localCa, conflict_resolutions: conflictResolutions ?? [] },
      peerCa: req.peer_ca,
    }
  );

  if (!finalizeResult.ok) {
    return reply.status(502).send({ error: finalizeResult.error ?? 'Finalisation échouée côté pair' });
  }

  peerQueries.create({
    peer_uuid: req.peer_uuid!,
    peer_name: req.peer_name!,
    peer_url: req.peer_url!,
    peer_ca: req.peer_ca,
    shared_secret: req.shared_secret,
    paired_at: Date.now(),
  });
  pairingQueries.delete(req.id);

  const peerCa = req.peer_ca?.trim() ?? null;
  const localCaStr = localCa?.trim() ?? null;
  const ca_same = !!peerCa && !!localCaStr && peerCa === localCaStr;

  return { success: true, peer_name: req.peer_name, peer_uuid: req.peer_uuid, ca_same };
}

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

  // ── mDNS discovery ────────────────────────────────────────────────────────
  fastify.get('/api/instances/discover', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const local = getLocalInstance();
    const peers = await discoverPeers();
    const knownUuids = new Set(peerQueries.getAll().map(p => p.peer_uuid));
    const filtered = peers.filter(p => p.uuid !== local.uuid && !knownUuids.has(p.uuid));
    return { peers: filtered };
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
      local_code: r.local_code,
      expires_at: r.expires_at,
    }));
    return { pending };
  });

  // ── Pairing: initiate (A contacts B) ──────────────────────────────────────
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
      local_code: string;
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
      return reply.status(502).send({ error: helloResult.error ?? 'Peer unreachable' });
    }

    const { to_uuid, to_name, to_url, ca: peerCa, local_code: remoteCode } = helloResult.data;

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
      remote_code: remoteCode,
      shared_secret: sharedSecret,
      expires_at: Date.now() + PAIRING_TTL_MS,
    });

    return {
      request_id: requestId,
      local_code: localCode,
      remote_code: remoteCode,
      peer_name: to_name,
      peer_uuid: to_uuid,
    };
  });

  // ── Pairing: confirm (A enters B's code, detects conflicts, or finalizes) ──
  fastify.post('/api/instances/pair/confirm', async (request, reply) => {
    if (!requireAuth(request, reply)) return;

    const { request_id, entered_code } = request.body as { request_id?: string; entered_code?: string };
    if (!request_id || !entered_code) {
      return reply.status(400).send({ error: 'Missing request_id or entered_code' });
    }

    pairingQueries.cleanExpired();
    const req = pairingQueries.getById(request_id);
    if (!req || req.direction !== 'initiated') {
      return reply.status(404).send({ error: 'Demande de pairing introuvable ou expirée' });
    }
    if (req.expires_at < Date.now()) {
      pairingQueries.delete(request_id);
      return reply.status(410).send({ error: 'Demande de pairing expirée' });
    }
    if (entered_code !== req.remote_code) {
      return reply.status(400).send({ error: 'Code incorrect' });
    }

    const local = getLocalInstance();

    // Fetch peer user list to detect conflicts
    const peerUsersResult = await peerFetch<{ users: Array<{ username: string; home_instance_uuid: string | null }> }>(
      req.peer_url!,
      '/api/instances/_peer/users',
      { peerCa: req.peer_ca, sharedSecret: req.shared_secret, senderUuid: local.uuid }
    );

    if (!peerUsersResult.ok || !peerUsersResult.data) {
      return reply.status(502).send({ error: peerUsersResult.error ?? 'Impossible de récupérer les utilisateurs du pair' });
    }

    const localUsers = userQueries.getAllForFederation();
    const localUsernames = new Set(localUsers.map(u => u.username));
    const conflicts = peerUsersResult.data.users.filter(u => localUsernames.has(u.username));

    if (conflicts.length > 0) {
      pairingQueries.updateConflicts(request_id, JSON.stringify(conflicts.map(u => u.username)));
      return {
        conflicts: conflicts.map(u => u.username),
        request_id,
        peer_name: req.peer_name,
        peer_uuid: req.peer_uuid,
      };
    }

    // No conflicts — finalize immediately
    return await finalizePairing(req, local.uuid, await loadLocalRootCa(), reply);
  });

  // ── Pairing: resolve user conflicts then finalize ─────────────────────────
  fastify.post('/api/instances/pair/resolve', async (request, reply) => {
    if (!requireAuth(request, reply)) return;

    const { request_id, resolutions } = request.body as {
      request_id?: string;
      resolutions?: Array<{ username: string; password_local: string; password_remote: string }>;
    };
    if (!request_id || !Array.isArray(resolutions) || resolutions.length === 0) {
      return reply.status(400).send({ error: 'Missing request_id or resolutions' });
    }

    pairingQueries.cleanExpired();
    const req = pairingQueries.getById(request_id);
    if (!req || req.direction !== 'initiated' || !req.conflicts) {
      return reply.status(404).send({ error: 'Demande de pairing introuvable, expirée ou sans conflit en attente' });
    }

    const local = getLocalInstance();

    // Validate all passwords
    for (const res of resolutions) {
      const localUser = userQueries.getByUsername(res.username);
      if (!localUser) return reply.status(400).send({ error: `Utilisateur local "${res.username}" introuvable` });

      const localOk = await bcrypt.compare(res.password_local, localUser.password_hash);
      if (!localOk) return reply.status(400).send({ error: `Mot de passe local incorrect pour "${res.username}"` });

      const remoteVerify = await peerFetch<{ valid: boolean }>(
        req.peer_url!,
        '/api/instances/_peer/auth/verify',
        {
          method: 'POST',
          body: { username: res.username, password: res.password_remote },
          peerCa: req.peer_ca,
          sharedSecret: req.shared_secret,
          senderUuid: local.uuid,
        }
      );
      if (!remoteVerify.ok || !remoteVerify.data?.valid) {
        return reply.status(400).send({ error: `Mot de passe distant incorrect pour "${res.username}"` });
      }
    }

    // All passwords valid — finalize with conflict resolutions
    const localCa = await loadLocalRootCa();
    const conflictResolutions = resolutions.map(r => ({ username: r.username, home_instance_uuid: local.uuid }));
    return await finalizePairing(req, local.uuid, localCa, reply, conflictResolutions);
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

    const localCode = sixDigitCode();
    const requestId = randomUUID();
    pairingQueries.cleanExpired();
    pairingQueries.create({
      id: requestId,
      direction: 'received',
      peer_uuid: body.from_uuid,
      peer_name: body.from_name,
      peer_url: body.from_url ?? null,
      peer_ca: null,
      local_code: localCode,
      remote_code: body.local_code,
      shared_secret: body.shared_secret,
      expires_at: Date.now() + PAIRING_TTL_MS,
    });

    const local = getLocalInstance();
    const ca = await loadLocalRootCa();
    return {
      to_uuid: local.uuid,
      to_name: local.name,
      to_url: local.url,
      ca,
      local_code: localCode,
    };
  });

  // ── Peer-to-peer: list users for conflict detection ───────────────────────
  fastify.get('/api/instances/_peer/users', async (request, reply) => {
    const peerUuid = request.headers['x-peer-uuid'] as string | undefined;
    if (!peerUuid) return reply.status(401).send({ error: 'Missing X-Peer-Uuid' });

    // Accept auth from pending pairing request OR established peer
    const pairingReq = pairingQueries.getByPeerUuid(peerUuid);
    const secret = pairingReq?.shared_secret ?? peerQueries.getByUuid(peerUuid)?.shared_secret;
    if (!secret || !verifyPeerHmac(request, reply, secret)) return;

    return { users: userQueries.getAllForFederation() };
  });

  // ── Peer-to-peer: verify password for conflict resolution ─────────────────
  fastify.post('/api/instances/_peer/auth/verify', async (request, reply) => {
    const body = request.body as { username?: string; password?: string };
    const peerUuid = request.headers['x-peer-uuid'] as string | undefined;
    if (!peerUuid || !body.username || !body.password) {
      return reply.status(400).send({ error: 'Missing required fields' });
    }

    const pairingReq = pairingQueries.getByPeerUuid(peerUuid);
    const secret = pairingReq?.shared_secret ?? peerQueries.getByUuid(peerUuid)?.shared_secret;
    if (!secret || !verifyPeerHmac(request, reply, secret)) return;

    const user = userQueries.getByUsername(body.username);
    if (!user) return { valid: false };

    const valid = await bcrypt.compare(body.password, user.password_hash);
    return { valid };
  });

  // ── Peer-to-peer: finalize (B completes pairing after A's confirm) ────────
  fastify.post('/api/instances/_peer/pair/finalize', async (request, reply) => {
    const body = request.body as {
      from_uuid?: string;
      local_code?: string;
      shared_secret?: string;
      ca?: string | null;
      conflict_resolutions?: Array<{ username: string; home_instance_uuid: string }>;
    };

    if (!body.from_uuid || !body.local_code || !body.shared_secret) {
      return reply.status(400).send({ error: 'Missing required fields' });
    }

    pairingQueries.cleanExpired();
    const req = pairingQueries.getByPeerUuid(body.from_uuid);
    if (!req || req.direction !== 'received') {
      return reply.status(404).send({ error: 'No pending pairing request from this peer' });
    }
    if (body.local_code !== req.remote_code) {
      return reply.status(400).send({ error: 'Code mismatch' });
    }
    if (body.shared_secret !== req.shared_secret) {
      return reply.status(400).send({ error: 'Secret mismatch' });
    }

    // Apply conflict resolutions: update home_instance_uuid for conflicting users
    for (const res of body.conflict_resolutions ?? []) {
      userQueries.setHomeInstance(res.username, res.home_instance_uuid);
    }

    peerQueries.create({
      peer_uuid: body.from_uuid,
      peer_name: req.peer_name!,
      peer_url: req.peer_url!,
      peer_ca: body.ca ?? null,
      shared_secret: req.shared_secret,
      paired_at: Date.now(),
    });
    pairingQueries.delete(req.id);

    return { success: true };
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
  // Auth: Bearer token of the user who just authenticated on this instance
  fastify.post('/api/instances/_peer/federation-join', async (request, reply) => {
    const token = request.headers.authorization?.replace('Bearer ', '');
    const session = token ? sessionQueries.getByToken(token) : null;
    if (!session) return reply.status(401).send({ error: 'Unauthorized' });

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

    return { success: true };
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
    return { success: true };
  });
}
