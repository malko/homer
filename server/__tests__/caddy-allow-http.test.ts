import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';

// Mock du module db AVANT l'import de caddy
vi.mock('../src/db/index.js', () => {
  return {
    proxyHostQueries: {
      getAll: vi.fn(),
    },
    settingQueries: {
      get: vi.fn(),
    },
  };
});

// Mock pour syncConfig
vi.mock('../src/services/caddy.js', async () => {
  const actual = await vi.importActual('../src/services/caddy.js');
  return {
    ...actual,
    syncConfig: vi.fn().mockResolvedValue({ success: true }),
  };
});

// Import APRÈS le mock
import { buildCaddyConfig } from '../src/services/caddy.js';
import { proxyHostQueries, settingQueries } from '../src/db/index.js';

const HOMER_PORT = '4000';

describe('Caddy buildCaddyConfig with allow_http', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Mock des variables d'environnement
    vi.stubEnv('HOMER_DOMAIN', '');
    vi.stubEnv('PORT', HOMER_PORT);
    vi.stubEnv('CADDY_ADMIN_URL', 'http://localhost:2019');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should NOT include proxy host in HTTP routes when allow_http is 0', () => {
    // Mock: pas de proxy hosts avec allow_http=0
    vi.mocked(proxyHostQueries.getAll).mockReturnValue([
      {
        id: 1,
        domain: 'app.local',
        upstream: 'http://app:8080',
        enabled: 1,
        tls_mode: 'internal',
        local_only: 0,
        basic_auth_user: null,
        basic_auth_password_hash: null,
        show_on_overview: 1,
        show_on_home: 0,
        mdns_enabled: 0,
        allow_http: 0,
      },
    ]);

    vi.mocked(settingQueries.get).mockReturnValue(null);

    const config = buildCaddyConfig();

    // Vérifier que le serveur HTTP existe
    const apps = config.apps as Record<string, unknown>;
    const http = apps.http as Record<string, unknown>;
    const servers = http.servers as Record<string, unknown>;

    // Le serveur HTTP (srv_http) ne doit pas inclure app.local car allow_http=0
    const srvHttp = servers.srv_http as Record<string, unknown>;
    const httpRoutes = srvHttp.routes as Array<Record<string, unknown>>;

    // Vérifier qu'aucune route ne contient app.local (sauf localhost/127.0.0.1)
    const appLocalRoutes = httpRoutes.filter((r: Record<string, unknown>) => {
      const match = r.match as Array<Record<string, unknown>>;
      if (!match || !Array.isArray(match) || match.length === 0) return false;
      const hosts = match[0].host as string[];
      return hosts && hosts.includes('app.local');
    });

    expect(appLocalRoutes.length).toBe(0);
  });

  it('should include proxy host in HTTP routes when allow_http is 1', () => {
    // Mock: proxy host avec allow_http=1
    vi.mocked(proxyHostQueries.getAll).mockReturnValue([
      {
        id: 1,
        domain: 'app.local',
        upstream: 'http://app:8080',
        enabled: 1,
        tls_mode: 'internal',
        local_only: 0,
        basic_auth_user: null,
        basic_auth_password_hash: null,
        show_on_overview: 1,
        show_on_home: 0,
        mdns_enabled: 0,
        allow_http: 1,
      },
    ]);

    vi.mocked(settingQueries.get).mockReturnValue(null);

    const config = buildCaddyConfig();

    // Vérifier que le serveur HTTP inclut app.local
    const apps = config.apps as Record<string, unknown>;
    const http = apps.http as Record<string, unknown>;
    const servers = http.servers as Record<string, unknown>;

    const srvHttp = servers.srv_http as Record<string, unknown>;
    const httpRoutes = srvHttp.routes as Array<Record<string, unknown>>;

    // Vérifier qu'une route contient app.local
    const appLocalRoutes = httpRoutes.filter((r: Record<string, unknown>) => {
      const match = r.match as Array<Record<string, unknown>>;
      if (!match || !Array.isArray(match) || match.length === 0) return false;
      const hosts = match[0].host as string[];
      return hosts && hosts.includes('app.local');
    });

    expect(appLocalRoutes.length).toBeGreaterThan(0);
  });

  it('should include both HTTP and HTTPS routes when allow_http is 1', () => {
    vi.mocked(proxyHostQueries.getAll).mockReturnValue([
      {
        id: 1,
        domain: 'app.local',
        upstream: 'http://app:8080',
        enabled: 1,
        tls_mode: 'internal',
        local_only: 0,
        basic_auth_user: null,
        basic_auth_password_hash: null,
        show_on_overview: 1,
        show_on_home: 0,
        mdns_enabled: 0,
        allow_http: 1,
      },
    ]);

    vi.mocked(settingQueries.get).mockReturnValue(null);

    const config = buildCaddyConfig();

    const apps = config.apps as Record<string, unknown>;
    const http = apps.http as Record<string, unknown>;
    const servers = http.servers as Record<string, unknown>;

    // Vérifier que app.local est dans le serveur HTTPS
    const srvHttps = servers.srv_https as Record<string, unknown>;
    const httpsRoutes = srvHttps.routes as Array<Record<string, unknown>>;

    const httpsAppRoutes = httpsRoutes.filter((r: Record<string, unknown>) => {
      const match = r.match as Array<Record<string, unknown>>;
      if (!match || !Array.isArray(match) || match.length === 0) return false;
      const hosts = match[0].host as string[];
      return hosts && hosts.includes('app.local');
    });

    expect(httpsAppRoutes.length).toBeGreaterThan(0);

    // Vérifier que app.local est aussi dans le serveur HTTP
    const srvHttp = servers.srv_http as Record<string, unknown>;
    const httpRoutes = srvHttp.routes as Array<Record<string, unknown>>;

    const httpAppRoutes = httpRoutes.filter((r: Record<string, unknown>) => {
      const match = r.match as Array<Record<string, unknown>>;
      if (!match || !Array.isArray(match) || match.length === 0) return false;
      const hosts = match[0].host as string[];
      return hosts && hosts.includes('app.local');
    });

    expect(httpAppRoutes.length).toBeGreaterThan(0);
  });

  it('should use default value 0 for allow_http for existing hosts (migration)', () => {
    // Simuler un host existant sans la colonne allow_http (sera undefined)
    vi.mocked(proxyHostQueries.getAll).mockReturnValue([
      {
        id: 1,
        domain: 'old-app.local',
        upstream: 'http://old-app:8080',
        enabled: 1,
        tls_mode: 'internal',
        local_only: 0,
        basic_auth_user: null,
        basic_auth_password_hash: null,
        show_on_overview: 1,
        show_on_home: 0,
        mdns_enabled: 0,
        // allow_http est undefined pour les anciens enregistrements
      } as Record<string, unknown> as never,
    ]);

    vi.mocked(settingQueries.get).mockReturnValue(null);

    const config = buildCaddyConfig();

    // Vérifier que old-app.local n'est PAS dans le serveur HTTP
    const apps = config.apps as Record<string, unknown>;
    const http = apps.http as Record<string, unknown>;
    const servers = http.servers as Record<string, unknown>;

    const srvHttp = servers.srv_http as Record<string, unknown>;
    const httpRoutes = srvHttp.routes as Array<Record<string, unknown>>;

    const oldAppRoutes = httpRoutes.filter((r: Record<string, unknown>) => {
      const match = r.match as Array<Record<string, unknown>>;
      if (!match || !Array.isArray(match) || match.length === 0) return false;
      const hosts = match[0].host as string[];
      return hosts && hosts.includes('old-app.local');
    });

    expect(oldAppRoutes.length).toBe(0);
  });
});

describe('Caddy buildCaddyConfig with homer_disable_http', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('HOMER_DOMAIN', 'homer.local');
    vi.stubEnv('PORT', HOMER_PORT);
    vi.stubEnv('CADDY_ADMIN_URL', 'http://localhost:2019');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should allow HTTP access when homer_disable_http is not set', () => {
    vi.mocked(proxyHostQueries.getAll).mockReturnValue([]);
    vi.mocked(settingQueries.get).mockImplementation((key: string) => {
      if (key === 'homer_disable_http') return null;
      if (key === 'caddy_cert_lifetime') return '10080';
      return null;
    });

    const config = buildCaddyConfig();
    const apps = config.apps as Record<string, unknown>;
    const http = apps.http as Record<string, unknown>;
    const servers = http.servers as Record<string, unknown>;

    // HTTP server should exist
    expect(servers.srv_http).toBeDefined();

    const srvHttp = servers.srv_http as Record<string, unknown>;
    const httpRoutes = srvHttp.routes as Array<Record<string, unknown>>;

    // Should have localhost route
    const localhostRoutes = httpRoutes.filter((r: Record<string, unknown>) => {
      const match = r.match as Array<Record<string, unknown>>;
      if (!match || !Array.isArray(match) || match.length === 0) return false;
      const hosts = match[0].host as string[];
      return hosts && (hosts.includes('localhost') || hosts.includes('127.0.0.1'));
    });

    expect(localhostRoutes.length).toBeGreaterThan(0);
  });

  it('should allow HTTP access when homer_disable_http is false', () => {
    vi.mocked(proxyHostQueries.getAll).mockReturnValue([]);
    vi.mocked(settingQueries.get).mockImplementation((key: string) => {
      if (key === 'homer_disable_http') return 'false';
      if (key === 'caddy_cert_lifetime') return '10080';
      return null;
    });

    const config = buildCaddyConfig();
    const apps = config.apps as Record<string, unknown>;
    const http = apps.http as Record<string, unknown>;
    const servers = http.servers as Record<string, unknown>;

    expect(servers.srv_http).toBeDefined();

    const srvHttp = servers.srv_http as Record<string, unknown>;
    const httpRoutes = srvHttp.routes as Array<Record<string, unknown>>;

    const localhostRoutes = httpRoutes.filter((r: Record<string, unknown>) => {
      const match = r.match as Array<Record<string, unknown>>;
      if (!match || !Array.isArray(match) || match.length === 0) return false;
      const hosts = match[0].host as string[];
      return hosts && (hosts.includes('localhost') || hosts.includes('127.0.0.1'));
    });

    expect(localhostRoutes.length).toBeGreaterThan(0);
  });

  it('should disable HTTP access when homer_disable_http is true', () => {
    vi.mocked(proxyHostQueries.getAll).mockReturnValue([]);
    vi.mocked(settingQueries.get).mockImplementation((key: string) => {
      if (key === 'homer_disable_http') return 'true';
      if (key === 'caddy_cert_lifetime') return '10080';
      return null;
    });

    const config = buildCaddyConfig();
    const apps = config.apps as Record<string, unknown>;
    const http = apps.http as Record<string, unknown>;
    const servers = http.servers as Record<string, unknown>;

    // HTTP server might still exist for proxy hosts with allow_http, but shouldn't have localhost
    if (servers.srv_http) {
      const srvHttp = servers.srv_http as Record<string, unknown>;
      const httpRoutes = srvHttp.routes as Array<Record<string, unknown>>;

      const localhostRoutes = httpRoutes.filter((r: Record<string, unknown>) => {
        const match = r.match as Array<Record<string, unknown>>;
        if (!match || !Array.isArray(match) || match.length === 0) return false;
        const hosts = match[0].host as string[];
        return hosts && (hosts.includes('localhost') || hosts.includes('127.0.0.1'));
      });

      expect(localhostRoutes.length).toBe(0);
    }

    // HTTPS server should still exist
    expect(servers.srv_https).toBeDefined();
  });

  it('should not include HOMER_DOMAIN in HTTP routes when disabled', () => {
    vi.mocked(proxyHostQueries.getAll).mockReturnValue([]);
    vi.mocked(settingQueries.get).mockImplementation((key: string) => {
      if (key === 'homer_disable_http') return 'true';
      if (key === 'caddy_cert_lifetime') return '10080';
      return null;
    });

    const config = buildCaddyConfig();
    const apps = config.apps as Record<string, unknown>;
    const http = apps.http as Record<string, unknown>;
    const servers = http.servers as Record<string, unknown>;

    if (servers.srv_http) {
      const srvHttp = servers.srv_http as Record<string, unknown>;
      const httpRoutes = srvHttp.routes as Array<Record<string, unknown>>;

      const homerDomainRoutes = httpRoutes.filter((r: Record<string, unknown>) => {
        const match = r.match as Array<Record<string, unknown>>;
        if (!match || !Array.isArray(match) || match.length === 0) return false;
        const hosts = match[0].host as string[];
        return hosts && hosts.includes('homer.local');
      });

      expect(homerDomainRoutes.length).toBe(0);
    }
  });

  it('should still allow proxy hosts with allow_http=1 when homer HTTP is disabled', () => {
    vi.mocked(proxyHostQueries.getAll).mockReturnValue([
      {
        id: 1,
        domain: 'app.local',
        upstream: 'http://app:8080',
        enabled: 1,
        tls_mode: 'internal',
        local_only: 0,
        basic_auth_user: null,
        basic_auth_password_hash: null,
        show_on_overview: 1,
        show_on_home: 0,
        mdns_enabled: 0,
        allow_http: 1,
      },
    ]);

    vi.mocked(settingQueries.get).mockImplementation((key: string) => {
      if (key === 'homer_disable_http') return 'true';
      if (key === 'caddy_cert_lifetime') return '10080';
      return null;
    });

    const config = buildCaddyConfig();
    const apps = config.apps as Record<string, unknown>;
    const http = apps.http as Record<string, unknown>;
    const servers = http.servers as Record<string, unknown>;

    // HTTP server should still exist for proxy hosts with allow_http=1
    expect(servers.srv_http).toBeDefined();

    const srvHttp = servers.srv_http as Record<string, unknown>;
    const httpRoutes = srvHttp.routes as Array<Record<string, unknown>>;

    // app.local should be in HTTP routes
    const appRoutes = httpRoutes.filter((r: Record<string, unknown>) => {
      const match = r.match as Array<Record<string, unknown>>;
      if (!match || !Array.isArray(match) || match.length === 0) return false;
      const hosts = match[0].host as string[];
      return hosts && hosts.includes('app.local');
    });

    expect(appRoutes.length).toBeGreaterThan(0);

    // But localhost should NOT be in HTTP routes
    const localhostRoutes = httpRoutes.filter((r: Record<string, unknown>) => {
      const match = r.match as Array<Record<string, unknown>>;
      if (!match || !Array.isArray(match) || match.length === 0) return false;
      const hosts = match[0].host as string[];
      return hosts && (hosts.includes('localhost') || hosts.includes('127.0.0.1'));
    });

    expect(localhostRoutes.length).toBe(0);
  });
});
