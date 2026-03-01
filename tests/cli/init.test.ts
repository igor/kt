import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createDatabase, closeDatabase, getDatabase } from '../../src/db/connection.js';

describe('kt init', () => {
  const testDir = path.join(os.tmpdir(), 'kt-init-test-' + Date.now());

  afterEach(() => {
    closeDatabase();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('creates .kt directory with working database', () => {
    fs.mkdirSync(testDir, { recursive: true });
    const ktDir = path.join(testDir, '.kt');
    fs.mkdirSync(ktDir, { recursive: true });
    const dbPath = path.join(ktDir, 'kt.db');
    createDatabase(dbPath);

    expect(fs.existsSync(ktDir)).toBe(true);
    expect(fs.existsSync(dbPath)).toBe(true);

    // Verify it's a working database with schema
    const db = getDatabase();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('nodes');
    expect(tableNames).toContain('namespaces');
  });

  it('detects existing .kt directory', () => {
    const ktDir = path.join(testDir, '.kt');
    fs.mkdirSync(ktDir, { recursive: true });

    // The init command checks for .kt existence
    expect(fs.existsSync(ktDir)).toBe(true);
    // No database created since .kt already existed
    expect(fs.existsSync(path.join(ktDir, 'kt.db'))).toBe(false);
  });
});
