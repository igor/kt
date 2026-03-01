import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveDatabase } from '../../src/db/connection.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('resolveDatabase', () => {
  const testDir = path.join(os.tmpdir(), 'kt-resolve-db-' + Date.now());
  const vaultRoot = path.join(testDir, 'my-vault');
  const subDir = path.join(vaultRoot, 'clients', 'acme');

  beforeEach(() => {
    fs.mkdirSync(subDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('finds .kt/kt.db walking up from subdirectory', () => {
    const ktDir = path.join(vaultRoot, '.kt');
    fs.mkdirSync(ktDir);
    fs.writeFileSync(path.join(ktDir, 'kt.db'), ''); // placeholder

    const result = resolveDatabase(subDir);
    expect(result.dbPath).toBe(path.join(ktDir, 'kt.db'));
    expect(result.vaultRoot).toBe(vaultRoot);
  });

  it('returns global fallback when no .kt/ found', () => {
    const result = resolveDatabase(subDir);
    expect(result.dbPath).toContain('.kt/kt.db');
    expect(result.vaultRoot).toBeNull();
  });

  it('KT_DB_PATH env var overrides everything', () => {
    const customPath = path.join(testDir, 'custom.db');
    const result = resolveDatabase(subDir, customPath);
    expect(result.dbPath).toBe(customPath);
    expect(result.vaultRoot).toBeNull();
  });
});
