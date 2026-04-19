import { FastifyRequest, FastifyReply } from 'fastify';
import { getLocalInstance } from '../services/instance.js';
import { peerQueries, sessionQueries } from '../db/index.js';
import { verifySignature, peerFetch } from '../services/peers.js';

declare module 'fastify' {
  interface FastifyRequest {
    isPeerRequest: boolean;
  }
}

const SKIP_PROXY_PREFIXES = ['/api/auth', '/api/instances', '/api/health', '/api/events'];

export async function peerProxyHook(request: FastifyRequest, reply: FastifyReply) {
  const peerUuid = request.headers['x-peer-uuid'] as string | undefined;
  const peerSig = request.headers['x-peer-signature'] as string | undefined;

  if (!peerUuid) return;

  const local = getLocalInstance();

  // ── Peer-to-peer mode (request FROM a peer, with HMAC) ───────────────────
  if (peerSig) {
    const peer = peerQueries.getByUuid(peerUuid);
    if (!peer) return reply.status(403).send({ error: 'Unknown peer' });

    const timestamp = Number(request.headers['x-peer-timestamp']);
    const bodyStr = request.body !== undefined ? JSON.stringify(request.body) : '';
    if (!verifySignature(peer.shared_secret, bodyStr, timestamp, peerSig)) {
      return reply.status(403).send({ error: 'Invalid peer signature' });
    }
    request.isPeerRequest = true;
    return;
  }

  // ── Proxy mode (request FROM UI targeting a remote peer) ─────────────────
  if (peerUuid === local.uuid) return; // targeting self — proceed normally

  // Don't proxy meta/auth routes
  if (SKIP_PROXY_PREFIXES.some(p => request.url.startsWith(p))) return;

  // Require local session for proxied requests
  const token = request.headers.authorization?.replace('Bearer ', '');
  const session = token ? sessionQueries.getByToken(token) : null;
  if (!session) return reply.status(401).send({ error: 'Unauthorized' });

  const peer = peerQueries.getByUuid(peerUuid);
  if (!peer) return reply.status(404).send({ error: `Unknown peer: ${peerUuid}` });

  const method = request.method as 'GET' | 'POST' | 'PUT' | 'DELETE';
  const result = await peerFetch<unknown>(peer.peer_url, request.url, {
    method,
    body: method !== 'GET' && method !== 'DELETE' ? request.body : undefined,
    peerCa: peer.peer_ca,
    sharedSecret: peer.shared_secret,
    senderUuid: local.uuid,
  });

  reply.status(result.status).send(result.data ?? { error: result.error });
}
