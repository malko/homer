import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { userQueries, sessionQueries, settingQueries, peerQueries } from '../db/index.js';
import { peerFetch, generateSecret, loadLocalRootCa } from '../services/peers.js';
import { getLocalInstance } from '../services/instance.js';
import { importCa } from '../services/caddy.js';

const HOMER_DOMAIN = process.env.HOMER_DOMAIN || '';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const createUserSchema = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(8),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8),
});

export async function authRoutes(fastify: FastifyInstance) {
  fastify.get('/api/auth/status', async (request, reply) => {
    const count = userQueries.count();
    const userCount = count['count(*)'];
    
    if (userCount === 0) {
      return reply.send({ needsSetup: true, mustChangePassword: false, authenticated: false, homerDomain: HOMER_DOMAIN || undefined });
    }
    
    const token = request.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return reply.send({ needsSetup: false, mustChangePassword: false, authenticated: false });
    }
    
    const session = sessionQueries.getByToken(token);
    if (!session) {
      return reply.send({ needsSetup: false, mustChangePassword: false, authenticated: false });
    }
    
    const user = userQueries.getByUsername(session.username);
    return reply.send({
      needsSetup: false,
      mustChangePassword: user?.must_change_password === 1,
      authenticated: true,
      username: session.username,
    });
  });

  fastify.post('/api/auth/setup', async (request, reply) => {
    const count = userQueries.count();
    
    if (count['count(*)'] > 0) {
      return reply.status(403).send({ error: 'Setup already completed' });
    }

    const body = createUserSchema.parse(request.body);
    const passwordHash = await bcrypt.hash(body.password, 10);
    
    userQueries.create(body.username, passwordHash);

    if (HOMER_DOMAIN) {
      const parts = HOMER_DOMAIN.split('.');
      if (parts.length >= 2) {
        const domainSuffix = '.' + parts.slice(-2).join('.');
        settingQueries.set('caddy_domain_suffix', domainSuffix);
      }
      settingQueries.set('caddy_extra_hostname', HOMER_DOMAIN);
    }

    const token = crypto.randomUUID();
    sessionQueries.create(token, body.username);
    
    return {
      token,
      username: body.username,
      mustChangePassword: false,
    };
  });

  fastify.post('/api/auth/setup-federation', async (request, reply) => {
    const count = userQueries.count();
    if (count['count(*)'] > 0) {
      return reply.status(403).send({ error: 'Setup already completed' });
    }

    const body = z.object({
      peer_url: z.string().url(),
      username: z.string().min(1),
      password: z.string().min(1),
      adopt_ca: z.boolean().optional().default(false),
    }).parse(request.body);

    // 1. Fetch remote instance identity (TOFU TLS)
    const selfResult = await peerFetch<{ uuid: string; name: string }>(body.peer_url, '/api/instances/self', { peerCa: null });
    if (!selfResult.ok || !selfResult.data?.uuid) {
      return reply.status(502).send({ error: selfResult.error ?? 'Cannot reach remote instance' });
    }
    const remoteUuid = selfResult.data.uuid;
    const remoteName = selfResult.data.name ?? 'remote';

    // 2. Verify credentials against remote instance
    const loginResult = await peerFetch<{ token: string }>(body.peer_url, '/api/auth/login', {
      method: 'POST',
      body: { username: body.username, password: body.password },
      peerCa: null,
      timeoutMs: 10_000,
    });
    if (!loginResult.ok || !loginResult.data?.token) {
      return reply.status(401).send({ error: 'Invalid credentials on remote instance' });
    }

    const loginToken = loginResult.data.token;

    // 3. Optionally adopt the remote CA so all instances share the same trust anchor
    if (body.adopt_ca) {
      const caExport = await peerFetch<{ cert: string; key: string }>(
        body.peer_url, '/api/proxy/ca-export',
        { peerCa: null, bearerToken: loginToken }
      );
      if (caExport.ok && caExport.data?.cert && caExport.data?.key) {
        await importCa(caExport.data.cert, caExport.data.key).catch(() => {});
      }
    }

    // 4. Fetch remote CA for future TLS (best effort)
    const caResult = await peerFetch<string>(body.peer_url, '/api/proxy/root-ca', { peerCa: null }).catch(() => null);
    const peerCa = typeof caResult?.data === 'string' ? caResult.data : await loadLocalRootCa();

    // 5. Generate the shared secret once — used on BOTH sides for HMAC
    const sharedSecret = generateSecret();

    // 6. Register this new instance as a peer on the home instance (best-effort)
    const local = getLocalInstance();
    const localCa = await loadLocalRootCa();
    peerFetch(body.peer_url, '/api/instances/_peer/federation-join', {
      method: 'POST',
      peerCa: null,
      bearerToken: loginToken,
      body: {
        peer_uuid: local.uuid,
        peer_name: local.name,
        peer_url: local.url,
        peer_ca: localCa,
        shared_secret: sharedSecret,
      },
    }).catch(() => {});

    // Best-effort logout on remote (after all token-authenticated calls)
    peerFetch(body.peer_url, '/api/auth/logout', { method: 'POST', peerCa: null }).catch(() => {});

    // 7. Store a peer entry for the home instance so login delegation knows the URL
    peerQueries.upsert({
      peer_uuid: remoteUuid,
      peer_name: remoteName,
      peer_url: body.peer_url,
      peer_ca: peerCa,
      shared_secret: sharedSecret,
      paired_at: Date.now(),
      status: 'online',
    });

    // 5. Create local federated user with cached hash (for offline fallback)
    const cachedHash = await bcrypt.hash(body.password, 10);
    const cachedHashExpiresAt = Date.now() + 24 * 3600 * 1000;
    userQueries.createFederated(body.username, remoteUuid, cachedHash, cachedHashExpiresAt);

    // 6. Create local session
    const token = crypto.randomUUID();
    sessionQueries.create(token, body.username);

    return { token, username: body.username, mustChangePassword: false };
  });

  fastify.post('/api/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);

    const user = userQueries.getByUsername(body.username);
    if (!user) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const localUuid = getLocalInstance().uuid;

    if (user.home_instance_uuid && user.home_instance_uuid !== localUuid) {
      // Federated user — delegate to home instance
      let authenticated = false;
      const peer = peerQueries.getByUuid(user.home_instance_uuid);

      if (peer) {
        const r = await peerFetch<{ token: string }>(peer.peer_url, '/api/auth/login', {
          method: 'POST',
          body: { username: body.username, password: body.password },
          peerCa: peer.peer_ca,
          timeoutMs: 10_000,
        });
        if (r.ok && r.data?.token) {
          authenticated = true;
          // Refresh cached hash so offline fallback stays current
          const cachedHash = await bcrypt.hash(body.password, 10);
          userQueries.setCachedHash(user.username, cachedHash, Date.now() + 24 * 3600 * 1000);
          // Best-effort logout of the remote session we just created
          peerFetch(peer.peer_url, '/api/auth/logout', { method: 'POST', peerCa: peer.peer_ca }).catch(() => {});
        }
      }

      if (!authenticated) {
        // Fallback: cached hash (works when home instance is unreachable)
        if (user.cached_password_hash && user.cached_hash_expires_at && user.cached_hash_expires_at > Date.now()) {
          const valid = await bcrypt.compare(body.password, user.cached_password_hash);
          if (valid) authenticated = true;
        }
      }

      if (!authenticated) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const token = crypto.randomUUID();
      sessionQueries.create(token, user.username);
      return { token, username: user.username, mustChangePassword: user.must_change_password === 1 };
    }

    // Local user — normal bcrypt check
    const valid = await bcrypt.compare(body.password, user.password_hash);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const token = crypto.randomUUID();
    sessionQueries.create(token, user.username);

    return {
      token,
      username: user.username,
      mustChangePassword: user.must_change_password === 1,
    };
  });

  fastify.post('/api/auth/change-password', async (request, reply) => {
    const authHeader = request.headers.authorization?.replace('Bearer ', '');
    const session = authHeader ? sessionQueries.getByToken(authHeader) : null;
    
    if (!session) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const body = changePasswordSchema.parse(request.body);
    const user = userQueries.getByUsername(session.username);
    
    if (!user) {
      return reply.status(401).send({ error: 'User not found' });
    }

    if (user.must_change_password === 0 && body.currentPassword) {
      const valid = await bcrypt.compare(body.currentPassword, user.password_hash);
      if (!valid) {
        return reply.status(400).send({ error: 'Current password is incorrect' });
      }
    }

    const newHash = await bcrypt.hash(body.newPassword, 10);
    userQueries.updatePassword(newHash, user.id);
    
    return { success: true };
  });

  fastify.post('/api/auth/logout', async (request, reply) => {
    const token = request.headers.authorization?.replace('Bearer ', '');
    if (token) {
      sessionQueries.delete(token);
    }
    return { success: true };
  });
}
