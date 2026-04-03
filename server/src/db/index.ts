/* eslint-disable @typescript-eslint/no-explicit-any */
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR ?? (process.env.NODE_ENV === 'production' ? '/app/data' : join(__dirname, '../../../data'));
const projectsDir = join(dataDir, 'projects');
const dbPath = join(dataDir, 'homelab.db');

export const DB_CONFIG = {
  dataDir,
  projectsDir,
  dbPath,
};

if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

let db: SqlJsDatabase;
let dbReady: Promise<void>;

async function initDb() {
  const SQL = await initSqlJs();
  
  if (existsSync(DB_CONFIG.dbPath)) {
    const fileBuffer = readFileSync(DB_CONFIG.dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      must_change_password INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      env_path TEXT,
      url TEXT,
      auto_update INTEGER DEFAULT 0,
      watch_enabled INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME DEFAULT (datetime('now', '+7 days'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);

    CREATE TABLE IF NOT EXISTS home_tiles (
      project_id INTEGER NOT NULL,
      service_key TEXT NOT NULL,
      display_name TEXT,
      icon TEXT,
      icon_bg TEXT,
      card_bg TEXT,
      hidden INTEGER DEFAULT 0,
      sort_order INTEGER,
      PRIMARY KEY (project_id, service_key)
    );

    CREATE TABLE IF NOT EXISTS home_external_tiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      icon TEXT,
      icon_bg TEXT,
      card_bg TEXT,
      hidden INTEGER DEFAULT 0,
      sort_order INTEGER
    );

    CREATE TABLE IF NOT EXISTS proxy_hosts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      domain TEXT NOT NULL,
      upstream TEXT NOT NULL,
      basic_auth_user TEXT,
      basic_auth_password_hash TEXT,
      local_only INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      tls_mode TEXT DEFAULT 'internal',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_proxy_hosts_domain ON proxy_hosts(domain);
  `);

  // Migrations
  try { db.run('ALTER TABLE projects ADD COLUMN url TEXT'); } catch {}
  try { db.run('ALTER TABLE projects ADD COLUMN icon TEXT'); } catch {}
  try { db.run("ALTER TABLE projects ADD COLUMN auto_update_policy TEXT DEFAULT 'all'"); } catch {}
  try { db.run('ALTER TABLE home_tiles ADD COLUMN icon_bg TEXT'); } catch {}
  try { db.run('ALTER TABLE home_tiles ADD COLUMN card_bg TEXT'); } catch {}
  try { db.run('ALTER TABLE home_tiles ADD COLUMN sort_order INTEGER'); } catch {}
  try { db.run('ALTER TABLE proxy_hosts ADD COLUMN show_on_overview INTEGER DEFAULT 1'); } catch {}
  try { db.run('ALTER TABLE proxy_hosts ADD COLUMN show_on_home INTEGER DEFAULT 0'); } catch {}
  try { db.run(`CREATE TABLE IF NOT EXISTS proxy_tile_overrides (
    proxy_host_id INTEGER PRIMARY KEY,
    display_name TEXT,
    icon TEXT,
    icon_bg TEXT,
    card_bg TEXT,
    hidden INTEGER DEFAULT 0,
    sort_order INTEGER
  )`); } catch {}

  saveDb();
}

function saveDb() {
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(DB_CONFIG.dbPath, buffer);
}

dbReady = initDb();

export async function waitForDb() {
  await dbReady;
}

export interface User {
  id: number;
  username: string;
  password_hash: string;
  must_change_password: number;
  created_at: string;
}

export type AutoUpdatePolicy = 'disabled' | 'all' | 'semver_minor' | 'semver_patch';

export interface Project {
  id: number;
  name: string;
  path: string;
  env_path: string | null;
  url: string | null;
  icon: string | null;
  auto_update: number;
  auto_update_policy: AutoUpdatePolicy;
  watch_enabled: number;
  created_at: string;
}

export interface Session {
  token: string;
  username: string;
  created_at: string;
  expires_at: string;
}

function rowToObj<T>(columns: string[], row: any[]): T {
  return columns.reduce((obj: Record<string, any>, col: string, i: number) => {
    obj[col] = row[i];
    return obj;
  }, {}) as T;
}

// Remap paths stored with a different prefix to the current dataDir.
// Handles: Docker (/app/data) and moved repo locations (e.g. /old/path/data → /new/path/data).
const DOCKER_DATA_DIR = '/app/data';
function normalizePath(p: string | null): string | null {
  if (!p) return p;
  // Already under current dataDir — no remapping needed
  if (p === dataDir || p.startsWith(dataDir + '/')) return p;
  // Docker prefix
  if (p.startsWith(DOCKER_DATA_DIR + '/') || p === DOCKER_DATA_DIR) {
    return join(dataDir, p.slice(DOCKER_DATA_DIR.length));
  }
  // Path stored from a different machine/repo location — extract the relative part after /data/
  const DATA_MARKER = '/data/';
  const idx = p.indexOf(DATA_MARKER);
  if (idx !== -1) {
    return join(dataDir, p.slice(idx + DATA_MARKER.length));
  }
  return p;
}
function normalizeProject(project: Project): Project {
  return {
    ...project,
    path: normalizePath(project.path) ?? project.path,
    env_path: normalizePath(project.env_path),
  };
}

export const userQueries = {
  getByUsername: (username: string): User | undefined => {
    const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
    stmt.bind([username]);
    if (stmt.step()) {
      const columns = stmt.getColumnNames();
      const row = stmt.get();
      stmt.free();
      return rowToObj<User>(columns, row);
    }
    stmt.free();
    return undefined;
  },
  create: (username: string, passwordHash: string) => {
    db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, passwordHash]);
    const result = db.exec('SELECT last_insert_rowid() as id');
    saveDb();
    return { lastInsertRowid: result[0].values[0][0] };
  },
  updatePassword: (passwordHash: string, id: number) => {
    db.run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [passwordHash, id]);
    saveDb();
  },
  count: (): { 'count(*)': number } => {
    const result = db.exec('SELECT COUNT(*) FROM users');
    return { 'count(*)': result[0].values[0][0] as number };
  },
};

export const projectQueries = {
  getAll: (): Project[] => {
    const result = db.exec('SELECT * FROM projects ORDER BY created_at DESC');
    if (result.length === 0) return [];
    const columns = result[0].columns;
    return result[0].values.map((row: any[]) => normalizeProject(rowToObj<Project>(columns, row)));
  },
  getById: (id: number): Project | undefined => {
    const stmt = db.prepare('SELECT * FROM projects WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
      const columns = stmt.getColumnNames();
      const row = stmt.get();
      stmt.free();
      return normalizeProject(rowToObj<Project>(columns, row));
    }
    stmt.free();
    return undefined;
  },
  create: (name: string, path: string, envPath: string | null, autoUpdate: number = 0, autoUpdatePolicy: AutoUpdatePolicy = 'all') => {
    db.run(
      'INSERT INTO projects (name, path, env_path, auto_update, auto_update_policy) VALUES (?, ?, ?, ?, ?)',
      [name, path, envPath, autoUpdate, autoUpdatePolicy]
    );
    const result = db.exec('SELECT last_insert_rowid() as id');
    saveDb();
    return { lastInsertRowid: result[0].values[0][0] };
  },
  update: (name: string, projectPath: string, envPath: string | null, url: string | null, icon: string | null, autoUpdate: number, autoUpdatePolicy: AutoUpdatePolicy, watchEnabled: number, id: number) => {
    db.run(
      'UPDATE projects SET name = ?, path = ?, env_path = ?, url = ?, icon = ?, auto_update = ?, auto_update_policy = ?, watch_enabled = ? WHERE id = ?',
      [name, projectPath, envPath, url, icon, autoUpdate, autoUpdatePolicy, watchEnabled, id]
    );
    saveDb();
  },
  delete: (id: number) => {
    db.run('DELETE FROM projects WHERE id = ?', [id]);
    saveDb();
  },
};

export interface HomeTileOverride {
  project_id: number;
  service_key: string;
  display_name: string | null;
  icon: string | null;
  icon_bg: string | null;
  card_bg: string | null;
  hidden: number;
  sort_order: number | null;
}

export interface ExternalTile {
  id: number;
  name: string;
  url: string;
  icon: string | null;
  icon_bg: string | null;
  card_bg: string | null;
  hidden: number;
  sort_order: number | null;
}

export const homeTileQueries = {
  getAll: (): HomeTileOverride[] => {
    const result = db.exec('SELECT * FROM home_tiles');
    if (result.length === 0) return [];
    const columns = result[0].columns;
    return result[0].values.map((row: any[]) => rowToObj<HomeTileOverride>(columns, row));
  },
  upsert: (projectId: number, serviceKey: string, displayName: string | null, icon: string | null, iconBg: string | null, cardBg: string | null, hidden: number) => {
    db.run(
      'INSERT INTO home_tiles (project_id, service_key, display_name, icon, icon_bg, card_bg, hidden) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, service_key) DO UPDATE SET display_name = excluded.display_name, icon = excluded.icon, icon_bg = excluded.icon_bg, card_bg = excluded.card_bg, hidden = excluded.hidden',
      [projectId, serviceKey, displayName, icon, iconBg, cardBg, hidden]
    );
    saveDb();
  },
  setOrderBatch: (items: Array<{ projectId: number; serviceKey: string; sortOrder: number }>) => {
    for (const { projectId, serviceKey, sortOrder } of items) {
      db.run(
        'INSERT INTO home_tiles (project_id, service_key, sort_order) VALUES (?, ?, ?) ON CONFLICT(project_id, service_key) DO UPDATE SET sort_order = excluded.sort_order',
        [projectId, serviceKey, sortOrder]
      );
    }
    saveDb();
  },
  deleteByProject: (projectId: number) => {
    db.run('DELETE FROM home_tiles WHERE project_id = ?', [projectId]);
    saveDb();
  },
};

export const externalTileQueries = {
  getAll: (): ExternalTile[] => {
    const result = db.exec('SELECT * FROM home_external_tiles ORDER BY COALESCE(sort_order, 999999), id');
    if (result.length === 0) return [];
    const columns = result[0].columns;
    return result[0].values.map((row: any[]) => rowToObj<ExternalTile>(columns, row));
  },
  create: (name: string, url: string, icon: string | null, iconBg: string | null, cardBg: string | null, hidden: number, sortOrder: number | null) => {
    db.run(
      'INSERT INTO home_external_tiles (name, url, icon, icon_bg, card_bg, hidden, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, url, icon, iconBg, cardBg, hidden, sortOrder]
    );
    const result = db.exec('SELECT last_insert_rowid() as id');
    saveDb();
    return { id: result[0].values[0][0] as number };
  },
  update: (id: number, name: string, url: string, icon: string | null, iconBg: string | null, cardBg: string | null, hidden: number) => {
    db.run(
      'UPDATE home_external_tiles SET name = ?, url = ?, icon = ?, icon_bg = ?, card_bg = ?, hidden = ? WHERE id = ?',
      [name, url, icon, iconBg, cardBg, hidden, id]
    );
    saveDb();
  },
  setOrderBatch: (items: Array<{ id: number; sortOrder: number }>) => {
    for (const { id, sortOrder } of items) {
      db.run('UPDATE home_external_tiles SET sort_order = ? WHERE id = ?', [sortOrder, id]);
    }
    saveDb();
  },
  delete: (id: number) => {
    db.run('DELETE FROM home_external_tiles WHERE id = ?', [id]);
    saveDb();
  },
};

export interface ProxyTileOverride {
  proxy_host_id: number;
  display_name: string | null;
  icon: string | null;
  icon_bg: string | null;
  card_bg: string | null;
  hidden: number;
  sort_order: number | null;
}

export const proxyTileQueries = {
  getAll: (): ProxyTileOverride[] => {
    const result = db.exec('SELECT * FROM proxy_tile_overrides');
    if (result.length === 0) return [];
    const columns = result[0].columns;
    return result[0].values.map((row: any[]) => rowToObj<ProxyTileOverride>(columns, row));
  },
  upsert: (proxyHostId: number, displayName: string | null, icon: string | null, iconBg: string | null, cardBg: string | null, hidden: number) => {
    db.run(
      'INSERT INTO proxy_tile_overrides (proxy_host_id, display_name, icon, icon_bg, card_bg, hidden) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(proxy_host_id) DO UPDATE SET display_name = excluded.display_name, icon = excluded.icon, icon_bg = excluded.icon_bg, card_bg = excluded.card_bg, hidden = excluded.hidden',
      [proxyHostId, displayName, icon, iconBg, cardBg, hidden]
    );
    saveDb();
  },
  setOrderBatch: (items: Array<{ proxyHostId: number; sortOrder: number }>) => {
    for (const { proxyHostId, sortOrder } of items) {
      db.run(
        'INSERT INTO proxy_tile_overrides (proxy_host_id, sort_order) VALUES (?, ?) ON CONFLICT(proxy_host_id) DO UPDATE SET sort_order = excluded.sort_order',
        [proxyHostId, sortOrder]
      );
    }
    saveDb();
  },
};

export interface ProxyHost {
  id: number;
  project_id: number | null;
  domain: string;
  upstream: string;
  basic_auth_user: string | null;
  basic_auth_password_hash: string | null;
  local_only: number;
  enabled: number;
  tls_mode: string;
  show_on_overview: number;
  show_on_home: number;
  created_at: string;
}

export const proxyHostQueries = {
  getAll: (): ProxyHost[] => {
    const result = db.exec('SELECT * FROM proxy_hosts ORDER BY domain');
    if (result.length === 0) return [];
    const columns = result[0].columns;
    return result[0].values.map((row: any[]) => rowToObj<ProxyHost>(columns, row));
  },
  getByProject: (projectId: number): ProxyHost[] => {
    const result = db.exec('SELECT * FROM proxy_hosts WHERE project_id = ? ORDER BY domain', [projectId]);
    if (result.length === 0) return [];
    const columns = result[0].columns;
    return result[0].values.map((row: any[]) => rowToObj<ProxyHost>(columns, row));
  },
  getById: (id: number): ProxyHost | undefined => {
    const stmt = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
      const columns = stmt.getColumnNames();
      const row = stmt.get();
      stmt.free();
      return rowToObj<ProxyHost>(columns, row);
    }
    stmt.free();
    return undefined;
  },
  create: (domain: string, upstream: string, projectId: number | null, basicAuthUser: string | null, basicAuthPasswordHash: string | null, localOnly: number, enabled: number, tlsMode: string, showOnOverview: number = 1, showOnHome: number = 0) => {
    db.run(
      'INSERT INTO proxy_hosts (domain, upstream, project_id, basic_auth_user, basic_auth_password_hash, local_only, enabled, tls_mode, show_on_overview, show_on_home) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [domain, upstream, projectId, basicAuthUser, basicAuthPasswordHash, localOnly, enabled, tlsMode, showOnOverview, showOnHome]
    );
    const result = db.exec('SELECT last_insert_rowid() as id');
    saveDb();
    return { id: result[0].values[0][0] as number };
  },
  update: (id: number, domain: string, upstream: string, projectId: number | null, basicAuthUser: string | null, basicAuthPasswordHash: string | null, localOnly: number, enabled: number, tlsMode: string, showOnOverview: number = 1, showOnHome: number = 0) => {
    db.run(
      'UPDATE proxy_hosts SET domain = ?, upstream = ?, project_id = ?, basic_auth_user = ?, basic_auth_password_hash = ?, local_only = ?, enabled = ?, tls_mode = ?, show_on_overview = ?, show_on_home = ? WHERE id = ?',
      [domain, upstream, projectId, basicAuthUser, basicAuthPasswordHash, localOnly, enabled, tlsMode, showOnOverview, showOnHome, id]
    );
    saveDb();
  },
  delete: (id: number) => {
    db.run('DELETE FROM proxy_hosts WHERE id = ?', [id]);
    saveDb();
  },
  deleteByProject: (projectId: number) => {
    db.run('DELETE FROM proxy_hosts WHERE project_id = ?', [projectId]);
    saveDb();
  },
};

export const settingQueries = {
  get: (key: string): string | null => {
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    stmt.bind([key]);
    if (stmt.step()) {
      const row = stmt.get();
      stmt.free();
      return row[0] as string | null;
    }
    stmt.free();
    return null;
  },
  set: (key: string, value: string) => {
    db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
    saveDb();
  },
};

export const sessionQueries = {
  create: (token: string, username: string) => {
    db.run('INSERT INTO sessions (token, username) VALUES (?, ?)', [token, username]);
    saveDb();
  },
  getByToken: (token: string): Session | undefined => {
    const stmt = db.prepare("SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')");
    stmt.bind([token]);
    if (stmt.step()) {
      const columns = stmt.getColumnNames();
      const row = stmt.get();
      stmt.free();
      return rowToObj<Session>(columns, row);
    }
    stmt.free();
    return undefined;
  },
  delete: (token: string) => {
    db.run('DELETE FROM sessions WHERE token = ?', [token]);
    saveDb();
  },
  deleteByUsername: (username: string) => {
    db.run('DELETE FROM sessions WHERE username = ?', [username]);
    saveDb();
  },
  cleanExpired: () => {
    db.run("DELETE FROM sessions WHERE expires_at <= datetime('now')");
    saveDb();
  },
};
