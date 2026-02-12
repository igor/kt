import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, closeDatabase, getDatabase } from '../../src/db/connection.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('digest', () => {
  const testDir = path.join(os.tmpdir(), 'kt-test-digest-' + Date.now());
  const testDb = path.join(testDir, 'kt.db');

  beforeEach(() => {
    createDatabase(testDb);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('digests table', () => {
    it('exists after database creation', () => {
      const db = getDatabase();
      const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='digests'"
      ).get() as { name: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.name).toBe('digests');
    });
  });
});
