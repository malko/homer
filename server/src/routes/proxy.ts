import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sessionQueries, proxyHostQueries } from '../db/index.js';
import { syncConfig, getRunningConfig, getCaddyStatus, pushConfig, hashBasicAuthPassword, buildCaddyConfig, exportLocalCa, importCa } from '../services/caddy.js';
import { publishIfEnabled, unpublishIfEnabled, getMdnsStatus } from '../services/mdns.js';

const coerceBool = z.union([z.boolean(), z.number()]).transform(v => !!v);

const proxyHostSchema = z.object({
  domain: z.string().min(1),
  upstream: z.string().min(1),
  project_id: z.number().nullable().optional(),
  basic_auth_user: z.string().nullable().optional(),
  basic_auth_password: z.string().nullable().optional(),
  local_only: coerceBool.optional(),
  enabled: coerceBool.optional(),
  tls_mode: z.enum(['internal', 'acme']).optional(),
  show_on_overview: coerceBool.optional(),
  show_on_home: coerceBool.optional(),
  mdns_enabled: coerceBool.optional(),
});

export async function proxyRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', async (request: FastifyRequest) => {
    if (request.isPeerRequest) return;
    const token = request.headers.authorization?.replace('Bearer ', '');
    const session = token ? sessionQueries.getByToken(token) : null;
    if (!session) {
      throw { statusCode: 401, message: 'Unauthorized' };
    }
  });

  // List all proxy hosts (optionally filter by project_id or show_on_home)
  fastify.get('/api/proxy/hosts', async (request) => {
    const { project_id, show_on_home } = request.query as { project_id?: string; show_on_home?: string };
    if (project_id) {
      return proxyHostQueries.getByProject(parseInt(project_id, 10));
    }
    const all = proxyHostQueries.getAll();
    if (show_on_home === '1') {
      return all.filter(h => h.show_on_home === 1);
    }
    return all;
  });

  // Get single proxy host
  fastify.get('/api/proxy/hosts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const host = proxyHostQueries.getById(parseInt(id, 10));
    if (!host) {
      return reply.status(404).send({ success: false, output: 'Proxy host not found' });
    }
    return host;
  });

  // Create proxy host
  fastify.post('/api/proxy/hosts', async (request, reply) => {
    const parsed = proxyHostSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, output: parsed.error.message });
    }
    const data = parsed.data;

    let passwordHash: string | null = null;
    if (data.basic_auth_user && data.basic_auth_password) {
      passwordHash = await hashBasicAuthPassword(data.basic_auth_password);
    }

    let mdnsEnabled = 0;
    if (data.mdns_enabled !== undefined) {
      mdnsEnabled = data.mdns_enabled ? 1 : 0;
    } else if (data.domain?.endsWith('.local')) {
      mdnsEnabled = 1;
    }

    try {
      const result = proxyHostQueries.create(
        data.domain,
        data.upstream,
        data.project_id ?? null,
        data.basic_auth_user ?? null,
        passwordHash,
        data.local_only ? 1 : 0,
        data.enabled !== false ? 1 : 0,
        data.tls_mode || 'internal',
        data.show_on_overview !== false ? 1 : 0,
        data.show_on_home ? 1 : 0,
        mdnsEnabled,
      );

      if (mdnsEnabled && data.enabled !== false) {
        await publishIfEnabled(data.domain);
      }

      const syncResult = await syncConfig();
      const host = proxyHostQueries.getById(result.id);
      return { success: true, host, caddy: syncResult };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('UNIQUE constraint')) {
        return reply.status(409).send({ success: false, output: 'A proxy host with this domain already exists' });
      }
      return reply.status(500).send({ success: false, output: message });
    }
  });

  // Update proxy host
  fastify.put('/api/proxy/hosts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const hostId = parseInt(id, 10);
    const existing = proxyHostQueries.getById(hostId);
    if (!existing) {
      return reply.status(404).send({ success: false, output: 'Proxy host not found' });
    }

    const parsed = proxyHostSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, output: parsed.error.message });
    }
    const data = parsed.data;

    let passwordHash = existing.basic_auth_password_hash;
    if (data.basic_auth_password !== undefined) {
      passwordHash = data.basic_auth_password ? await hashBasicAuthPassword(data.basic_auth_password) : null;
    }

    const newDomain = data.domain ?? existing.domain;
    const wasMdnsEnabled = existing.mdns_enabled === 1;
    let newMdnsEnabled = existing.mdns_enabled;
    if (data.mdns_enabled !== undefined) {
      newMdnsEnabled = data.mdns_enabled ? 1 : 0;
    } else if (newDomain !== existing.domain) {
      newMdnsEnabled = newDomain.endsWith('.local') ? 1 : 0;
    }

    try {
      proxyHostQueries.update(
        hostId,
        newDomain,
        data.upstream ?? existing.upstream,
        data.project_id !== undefined ? data.project_id ?? null : existing.project_id,
        data.basic_auth_user !== undefined ? data.basic_auth_user ?? null : existing.basic_auth_user,
        passwordHash,
        data.local_only !== undefined ? (data.local_only ? 1 : 0) : existing.local_only,
        data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing.enabled,
        data.tls_mode ?? existing.tls_mode,
        data.show_on_overview !== undefined ? (data.show_on_overview ? 1 : 0) : existing.show_on_overview,
        data.show_on_home !== undefined ? (data.show_on_home ? 1 : 0) : existing.show_on_home,
        newMdnsEnabled,
      );

      const isEnabled = data.enabled !== undefined ? data.enabled : existing.enabled;
      const domainChanged = newDomain !== existing.domain;
      if (newMdnsEnabled && isEnabled) {
        if (domainChanged && wasMdnsEnabled) {
          await unpublishIfEnabled(existing.domain);
        }
        await publishIfEnabled(newDomain);
      } else if (!newMdnsEnabled && wasMdnsEnabled) {
        await unpublishIfEnabled(existing.domain);
      }

      const syncResult = await syncConfig();
      const host = proxyHostQueries.getById(hostId);
      return { success: true, host, caddy: syncResult };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('UNIQUE constraint')) {
        return reply.status(409).send({ success: false, output: 'A proxy host with this domain already exists' });
      }
      return reply.status(500).send({ success: false, output: message });
    }
  });

  // Delete proxy host
  fastify.delete('/api/proxy/hosts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const hostId = parseInt(id, 10);
    const existing = proxyHostQueries.getById(hostId);
    if (!existing) {
      return reply.status(404).send({ success: false, output: 'Proxy host not found' });
    }

    if (existing.mdns_enabled) {
      await unpublishIfEnabled(existing.domain);
    }

    proxyHostQueries.delete(hostId);
    const syncResult = await syncConfig();
    return { success: true, caddy: syncResult };
  });

  // Get running Caddy config
  fastify.get('/api/proxy/config', async () => {
    const config = await getRunningConfig();
    const generated = buildCaddyConfig();
    return { running: config, generated };
  });

  // Push custom Caddy config
  fastify.put('/api/proxy/config', async (request, reply) => {
    const { config, saveAsOverride } = request.body as { config: Record<string, unknown>; saveAsOverride?: boolean };
    if (!config) {
      return reply.status(400).send({ success: false, output: 'Config is required' });
    }

    if (saveAsOverride) {
      const { settingQueries: sq } = await import('../db/index.js');
      sq.set('caddy_config_override', JSON.stringify(config));
    }

    const result = await pushConfig(config);
    return result;
  });

  // Caddy status
  fastify.get('/api/proxy/status', async () => {
    return getCaddyStatus();
  });

  // Force reload from DB
  fastify.post('/api/proxy/reload', async () => {
    // Clear any override so we regenerate from DB
    const { settingQueries: sq } = await import('../db/index.js');
    sq.set('caddy_config_override', '');
    return syncConfig();
  });

  // MDNS status
  fastify.get('/api/proxy/mdns', async () => {
    return getMdnsStatus();
  });

  // Export local CA cert + private key (admin only — the key is sensitive)
  fastify.get('/api/proxy/ca-export', async (request, reply) => {
    const ca = await exportLocalCa();
    if (!ca) return reply.status(503).send({ error: 'CA unavailable — start Caddy first' });
    return ca;
  });

  // Import an external CA cert + private key and reconfigure Caddy to use it
  fastify.post('/api/proxy/ca-import', async (request, reply) => {
    const { cert, key } = request.body as { cert?: string; key?: string };
    if (!cert || !key) return reply.status(400).send({ error: 'cert and key are required' });
    const result = await importCa(cert, key);
    if (!result.success) return reply.status(500).send({ error: result.error });
    return { success: true };
  });
}
