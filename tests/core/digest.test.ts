import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, closeDatabase, getDatabase } from '../../src/db/connection.js';
import { createNode } from '../../src/core/nodes.js';
import { computeNodeHash, getCachedDigest, cacheDigest } from '../../src/core/digest.js';
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

  describe('computeNodeHash', () => {
    it('returns consistent hash for same nodes', () => {
      const n1 = createNode({ namespace: 'test', content: 'Alpha' });
      const n2 = createNode({ namespace: 'test', content: 'Beta' });
      const hash1 = computeNodeHash([n1, n2]);
      const hash2 = computeNodeHash([n1, n2]);
      expect(hash1).toBe(hash2);
    });

    it('returns different hash when nodes change', () => {
      const n1 = createNode({ namespace: 'test', content: 'Alpha' });
      const hash1 = computeNodeHash([n1]);
      const n2 = createNode({ namespace: 'test', content: 'Gamma' });
      const hash2 = computeNodeHash([n1, n2]);
      expect(hash1).not.toBe(hash2);
    });

    it('returns empty string for empty array', () => {
      const hash = computeNodeHash([]);
      expect(hash).toBe('');
    });
  });

  describe('cache', () => {
    it('returns null when no cached digest exists', () => {
      const result = getCachedDigest('test', 'somehash', 2);
      expect(result).toBeNull();
    });

    it('stores and retrieves a cached digest', () => {
      cacheDigest('test', 'The digest content', 'hash123', 2);
      const result = getCachedDigest('test', 'hash123', 2);
      expect(result).toBe('The digest content');
    });

    it('returns null when hash does not match', () => {
      cacheDigest('test', 'The digest content', 'hash123', 2);
      const result = getCachedDigest('test', 'different-hash', 2);
      expect(result).toBeNull();
    });

    it('returns null when days do not match', () => {
      cacheDigest('test', 'The digest content', 'hash123', 2);
      const result = getCachedDigest('test', 'hash123', 7);
      expect(result).toBeNull();
    });

    it('overwrites cache for same namespace', () => {
      cacheDigest('test', 'Old content', 'hash1', 2);
      cacheDigest('test', 'New content', 'hash2', 2);
      const result = getCachedDigest('test', 'hash2', 2);
      expect(result).toBe('New content');
    });
  });
});
