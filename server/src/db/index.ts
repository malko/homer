/* eslint-disable @typescript-eslint/no-explicit-any */
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

const dataDir = '/app/data';
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
  `);
  
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

export interface Project {
  id: number;
  name: string;
  path: string;
  env_path: string | null;
  auto_update: number;
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
    return result[0].values.map((row: any[]) => rowToObj<Project>(columns, row));
  },
  getById: (id: number): Project | undefined => {
    const stmt = db.prepare('SELECT * FROM projects WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
      const columns = stmt.getColumnNames();
      const row = stmt.get();
      stmt.free();
      return rowToObj<Project>(columns, row);
    }
    stmt.free();
    return undefined;
  },
  create: (name: string, path: string, envPath: string | null) => {
    db.run('INSERT INTO projects (name, path, env_path) VALUES (?, ?, ?)', [name, path, envPath]);
    const result = db.exec('SELECT last_insert_rowid() as id');
    saveDb();
    return { lastInsertRowid: result[0].values[0][0] };
  },
  update: (name: string, projectPath: string, envPath: string | null, autoUpdate: number, watchEnabled: number, id: number) => {
    db.run('UPDATE projects SET name = ?, path = ?, env_path = ?, auto_update = ?, watch_enabled = ? WHERE id = ?', [name, projectPath, envPath, autoUpdate, watchEnabled, id]);
    saveDb();
  },
  delete: (id: number) => {
    db.run('DELETE FROM projects WHERE id = ?', [id]);
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
