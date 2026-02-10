import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, closeDatabase, getDatabase } from '../../src/db/connection.js';
import { createNode } from '../../src/core/nodes.js';
import { searchNodes } from '../../src/core/search.js';
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
