import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import * as sqliteVec from 'sqlite-vec';

let db: Database.Database | null = null;

export interface DatabaseResolution {
  dbPath: string;
  vaultRoot: string | null;
}

export function resolveDatabase(cwd: string, envOverride?: string): DatabaseResolution {
  if (envOverride) {
    return { dbPath: envOverride, vaultRoot: null };
  }

  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;

  while (dir !== root) {
    if (fs.existsSync(path.join(dir, '.kt'))) {
      return { dbPath: path.join(dir, '.kt', 'kt.db'), vaultRoot: dir };
    }
    dir = path.dirname(dir);
  }

  const globalDir = path.join(os.homedir(), '.kt');
  return { dbPath: path.join(globalDir, 'kt.db'), vaultRoot: null };
}

export function createDatabase(dbPath: string): Database.Database {
  // Ensure directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Load sqlite-vec extension for vector search
  sqliteVec.load(db);

  // Run schema
  const schemaPath = new URL('schema.sql', import.meta.url).pathname;
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  return db;
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call createDatabase() first.');
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function getDefaultDbPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '~';
  return path.join(home, '.kt', 'kt.db');
}
