import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, closeDatabase } from '../../src/db/connection.js';
import { createNode } from '../../src/core/nodes.js';
import { getLinks } from '../../src/core/links.js';
import { insertEmbedding } from '../../src/db/vec.js';
import { findSimilarNodes, captureWithIntelligence } from '../../src/core/capture.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('smart capture', () => {
  const testDir = path.join(os.tmpdir(), 'kt-test-capture-' + Date.now());
  const testDb = path.join(testDir, 'kt.db');

  beforeEach(() => {
    createDatabase(testDb);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('findSimilarNodes', () => {
    it('finds similar nodes by embedding', () => {
      const existing = createNode({ namespace: 'test', content: 'Client X prefers quarterly planning' });

      const embExisting = new Float32Array(768).fill(0);
      embExisting[0] = 0.9; embExisting[1] = 0.8;
      insertEmbedding(existing.id, embExisting);

      const queryEmb = new Float32Array(768).fill(0);
      queryEmb[0] = 0.88; queryEmb[1] = 0.78;

      const similar = findSimilarNodes(queryEmb, { namespace: 'test', limit: 5 });
      expect(similar.length).toBeGreaterThan(0);
      expect(similar[0].id).toBe(existing.id);
    });

    it('falls back to keyword search when no embeddings exist', () => {
      createNode({ namespace: 'test', content: 'quarterly planning cycles' });

      const similar = findSimilarNodes(null, { namespace: 'test', keyword: 'quarterly' });
      expect(similar.length).toBeGreaterThan(0);
    });
  });

  describe('captureWithIntelligence', () => {
    it('creates a node and returns similar nodes', () => {
      // Pre-existing node with embedding
      const existing = createNode({ namespace: 'test', content: 'Sprint planning discussion' });
      const emb = new Float32Array(768).fill(0);
      emb[0] = 0.9; emb[1] = 0.8;
      insertEmbedding(existing.id, emb);

      const result = captureWithIntelligence({
        namespace: 'test',
        content: 'Client rejected sprint format',
        // No embedding available (Ollama down) — keyword fallback
        embedding: null,
      });

      expect(result.node.id).toMatch(/^kt-/);
      expect(result.node.content).toBe('Client rejected sprint format');
      // Similar nodes found via keyword ("sprint")
      expect(result.similar).toBeDefined();
    });

    it('auto-links to similar nodes when embedding is provided', () => {
      const existing = createNode({ namespace: 'test', content: 'Existing knowledge' });
      const embExisting = new Float32Array(768).fill(0);
      embExisting[0] = 0.9; embExisting[1] = 0.8;
      insertEmbedding(existing.id, embExisting);

      const newEmb = new Float32Array(768).fill(0);
      newEmb[0] = 0.88; newEmb[1] = 0.78;

      const result = captureWithIntelligence({
        namespace: 'test',
        content: 'Related knowledge',
        embedding: newEmb,
        autoLink: true,
      });

      // Should have auto-linked to the existing similar node
      const links = getLinks(result.node.id);
      expect(links.length).toBeGreaterThan(0);
      expect(links[0].link_type).toBe('related');
      expect(links[0].target_id).toBe(existing.id);
    });
  });
});
