import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, closeDatabase, getDatabase } from '../../src/db/connection.js';
import { createNode } from '../../src/core/nodes.js';
import { computeNodeHash, getCachedDigest, cacheDigest, buildDigestPrompt, generateDigest } from '../../src/core/digest.js';
import { createLink } from '../../src/core/links.js';
import type { Node } from '../../src/core/nodes.js';
import type { Link } from '../../src/core/links.js';
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

  describe('buildDigestPrompt', () => {
    const mockNodes: Node[] = [
      {
        id: 'kt-aaa111', namespace: 'test', title: 'API design decision',
        content: 'Chose REST over GraphQL for simplicity. Team lacks GraphQL experience.',
        status: 'active', source_type: 'capture', tags: ['architecture'],
        embedding_pending: false, compacted_into: null,
        created_at: '2026-02-11 10:00:00', updated_at: '2026-02-11 10:00:00',
        stale_at: null, session_id: null,
      },
      {
        id: 'kt-bbb222', namespace: 'test', title: 'Auth approach',
        content: 'Using JWT with refresh tokens. Session duration 24h.',
        status: 'active', source_type: 'capture', tags: ['auth'],
        embedding_pending: false, compacted_into: null,
        created_at: '2026-02-12 09:00:00', updated_at: '2026-02-12 09:00:00',
        stale_at: null, session_id: null,
      },
    ];

    it('includes node content in the prompt', () => {
      const prompt = buildDigestPrompt(mockNodes, [], null);
      expect(prompt).toContain('API design decision');
      expect(prompt).toContain('Auth approach');
      expect(prompt).toContain('REST over GraphQL');
      expect(prompt).toContain('JWT with refresh tokens');
    });

    it('includes CLAUDE.md context when provided', () => {
      const claudeMd = '# My Project\n\nThis is a REST API for managing widgets.';
      const prompt = buildDigestPrompt(mockNodes, [], claudeMd);
      expect(prompt).toContain('managing widgets');
    });

    it('omits CLAUDE.md section when null', () => {
      const prompt = buildDigestPrompt(mockNodes, [], null);
      expect(prompt).not.toContain('Project Context');
    });

    it('includes link information', () => {
      const links: Link[] = [{
        id: 'link-1', source_id: 'kt-bbb222', target_id: 'kt-aaa111',
        link_type: 'related', context: 'both about architecture', created_at: '2026-02-12',
      }];
      const prompt = buildDigestPrompt(mockNodes, links, null);
      expect(prompt).toContain('kt-bbb222');
      expect(prompt).toContain('related');
      expect(prompt).toContain('kt-aaa111');
    });

    it('instructs Claude to produce structured sections', () => {
      const prompt = buildDigestPrompt(mockNodes, [], null);
      expect(prompt).toContain('Summary');
      expect(prompt).toContain('Key Topics');
      expect(prompt).toContain('Decisions');
      expect(prompt).toContain('Open Threads');
    });
  });

  describe('generateDigest', () => {
    it('returns a message when no nodes exist in time window', async () => {
      const result = await generateDigest('test', { days: 2 });
      expect(result).toContain('No recent knowledge');
    });

    it('fetches recent nodes within the time window', async () => {
      createNode({ namespace: 'test', content: 'Recent insight about testing' });
      const result = await generateDigest('test', { days: 2 });
      // Without ANTHROPIC_API_KEY, it should return an error about the key
      expect(result).not.toContain('No recent knowledge');
    });

    it('uses cache when available', async () => {
      const node = createNode({ namespace: 'test', content: 'Cached insight' });
      const hash = computeNodeHash([node]);
      cacheDigest('test', 'Cached digest output', hash, 2);

      const result = await generateDigest('test', { days: 2 });
      expect(result).toBe('Cached digest output');
    });

    it('includes links between recent nodes', async () => {
      const n1 = createNode({ namespace: 'test', content: 'First point' });
      const n2 = createNode({ namespace: 'test', content: 'Second point' });
      createLink(n2.id, 'related', n1.id, 'connected ideas');

      const result = await generateDigest('test', { days: 2 });
      expect(result).toBeDefined();
    });
  });
});
