import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, closeDatabase, getDatabase } from '../../src/db/connection.js';
import { createNode, updateNodeStatus } from '../../src/core/nodes.js';
import { searchNodes, semanticSearch } from '../../src/core/search.js';
import { insertEmbedding } from '../../src/db/vec.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('keyword search', () => {
  const testDir = path.join(os.tmpdir(), 'kt-test-search-' + Date.now());
  const testDb = path.join(testDir, 'kt.db');

  beforeEach(() => {
    createDatabase(testDb);
    createNode({ namespace: 'test', content: 'Client X prefers quarterly planning cycles', title: 'Client X planning' });
    createNode({ namespace: 'test', content: 'Pricing model uses three tiers', title: 'Pricing tiers' });
    createNode({ namespace: 'test', content: 'Client Y rejected the sprint format', title: 'Client Y sprints' });
    createNode({ namespace: 'other', content: 'Unrelated knowledge in other namespace' });
  });

  afterEach(() => { closeDatabase(); fs.rmSync(testDir, { recursive: true, force: true }); });

  it('finds nodes matching content keyword', () => {
    const results = searchNodes('quarterly');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Client X planning');
  });

  it('finds nodes matching title keyword', () => {
    const results = searchNodes('Pricing');
    expect(results).toHaveLength(1);
  });

  it('filters by namespace', () => {
    const results = searchNodes('knowledge', { namespace: 'other' });
    expect(results).toHaveLength(1);
  });

  it('is case-insensitive', () => {
    const results = searchNodes('client');
    expect(results).toHaveLength(2); // Client X and Client Y
  });

  it('excludes compacted nodes', () => {
    const node = createNode({ namespace: 'test', content: 'compacted keyword match' });
    const db = getDatabase();
    db.prepare("UPDATE nodes SET status = 'compacted' WHERE id = ?").run(node.id);

    const results = searchNodes('compacted');
    expect(results).toHaveLength(0);
  });
});

describe('semantic search', () => {
  const testDir = path.join(os.tmpdir(), 'kt-test-semantic-' + Date.now());
  const testDb = path.join(testDir, 'kt.db');

  beforeEach(() => {
    createDatabase(testDb);

    // Create nodes with fake embeddings that have known similarity
    const nodeA = createNode({ namespace: 'test', content: 'Quarterly planning preference', title: 'Planning' });
    const nodeB = createNode({ namespace: 'test', content: 'Sprint format rejected', title: 'Sprints' });
    const nodeC = createNode({ namespace: 'test', content: 'Pricing model discussion', title: 'Pricing' });

    // Embedding A and B are similar (both about planning), C is different
    const embA = new Float32Array(768).fill(0);
    embA[0] = 0.9; embA[1] = 0.8; embA[2] = 0.1;

    const embB = new Float32Array(768).fill(0);
    embB[0] = 0.85; embB[1] = 0.75; embB[2] = 0.15;

    const embC = new Float32Array(768).fill(0);
    embC[0] = 0.1; embC[1] = 0.1; embC[2] = 0.9;

    insertEmbedding(nodeA.id, embA);
    insertEmbedding(nodeB.id, embB);
    insertEmbedding(nodeC.id, embC);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('finds nodes by embedding similarity', () => {
    // Query similar to A and B (planning-related)
    const queryEmb = new Float32Array(768).fill(0);
    queryEmb[0] = 0.88; queryEmb[1] = 0.78; queryEmb[2] = 0.12;

    const results = semanticSearch(queryEmb, { limit: 2 });
    expect(results.length).toBe(2);
    // Both planning-related nodes should come before pricing
    const titles = results.map(r => r.title);
    expect(titles).not.toContain('Pricing');
  });

  it('filters by namespace', () => {
    // Add a node in a different namespace
    const other = createNode({ namespace: 'other', content: 'Other content' });
    const embOther = new Float32Array(768).fill(0);
    embOther[0] = 0.9; embOther[1] = 0.8;
    insertEmbedding(other.id, embOther);

    const queryEmb = new Float32Array(768).fill(0);
    queryEmb[0] = 0.9; queryEmb[1] = 0.8;

    const results = semanticSearch(queryEmb, { namespace: 'test', limit: 10 });
    const namespaces = results.map(r => r.namespace);
    expect(namespaces.every(n => n === 'test')).toBe(true);
  });

  it('excludes compacted nodes', () => {
    // Mark a node as compacted
    const nodes = createNode({ namespace: 'test', content: 'test' });
    updateNodeStatus(nodes.id, 'compacted');

    const queryEmb = new Float32Array(768).fill(0);
    queryEmb[0] = 0.9; queryEmb[1] = 0.8;

    const results = semanticSearch(queryEmb, { limit: 10 });
    const ids = results.map(r => r.id);
    expect(ids).not.toContain(nodes.id);
  });
});
