import { describe, it, expect, afterEach } from 'vitest';
import { createDatabase, closeDatabase } from '../../src/db/connection.js';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('database connection', () => {
  const testDir = path.join(os.tmpdir(), 'kt-test-' + Date.now());
  const testDb = path.join(testDir, 'kt.db');

  afterEach(() => {
    closeDatabase();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('creates database file and runs migrations', () => {
    const db = createDatabase(testDb);
    expect(fs.existsSync(testDb)).toBe(true);

    // Verify tables exist
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const tableNames = tables.map(t => t.name);

    expect(tableNames).toContain('nodes');
    expect(tableNames).toContain('links');
    expect(tableNames).toContain('namespaces');
    expect(tableNames).toContain('project_mappings');
  });

  it('enables WAL mode', () => {
    const db = createDatabase(testDb);
    const result = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(result.journal_mode).toBe('wal');
  });
});
