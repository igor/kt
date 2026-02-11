import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, closeDatabase, getDatabase } from '../../src/db/connection.js';
import { createNode, getNode } from '../../src/core/nodes.js';
import { createLink } from '../../src/core/links.js';
import { detectStaleNodes } from '../../src/core/staleness.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('staleness detection', () => {
  const testDir = path.join(os.tmpdir(), 'kt-test-stale-' + Date.now());
  const testDb = path.join(testDir, 'kt.db');

  beforeEach(() => createDatabase(testDb));
  afterEach(() => { closeDatabase(); fs.rmSync(testDir, { recursive: true, force: true }); });

  it('marks nodes as stale when they exceed age threshold', () => {
    const node = createNode({ namespace: 'test', content: 'old knowledge' });

    // Manually backdate the node to 90 days ago
    const db = getDatabase();
    db.prepare("UPDATE nodes SET updated_at = datetime('now', '-90 days'), created_at = datetime('now', '-90 days') WHERE id = ?").run(node.id);

    const result = detectStaleNodes({ maxAgeDays: 60 });
    expect(result.staled).toHaveLength(1);
    expect(result.staled[0]).toBe(node.id);

    const updated = getNode(node.id);
    expect(updated!.status).toBe('stale');
  });

  it('does not mark recent nodes as stale', () => {
    createNode({ namespace: 'test', content: 'fresh knowledge' });

    const result = detectStaleNodes({ maxAgeDays: 60 });
    expect(result.staled).toHaveLength(0);
  });

  it('does not re-stale already stale nodes', () => {
    const node = createNode({ namespace: 'test', content: 'already stale' });
    const db = getDatabase();
    db.prepare("UPDATE nodes SET status = 'stale', stale_at = datetime('now'), updated_at = datetime('now', '-90 days') WHERE id = ?").run(node.id);

    const result = detectStaleNodes({ maxAgeDays: 60 });
    expect(result.staled).toHaveLength(0);
  });

  it('marks nodes with unlinked low activity as stale', () => {
    const node = createNode({ namespace: 'test', content: 'orphan node' });
    const db = getDatabase();
    // 45 days old, no links
    db.prepare("UPDATE nodes SET updated_at = datetime('now', '-45 days'), created_at = datetime('now', '-45 days') WHERE id = ?").run(node.id);

    const result = detectStaleNodes({ maxAgeDays: 60, orphanAgeDays: 30 });
    expect(result.staled).toHaveLength(1);
  });

  it('does not stale old nodes that have recent inbound links', () => {
    const old = createNode({ namespace: 'test', content: 'old but referenced' });
    const recent = createNode({ namespace: 'test', content: 'recent node' });
    const db = getDatabase();
    db.prepare("UPDATE nodes SET updated_at = datetime('now', '-90 days'), created_at = datetime('now', '-90 days') WHERE id = ?").run(old.id);

    // Recent node links to old node — old node is still relevant
    createLink(recent.id, 'related', old.id);

    // With reference protection on, should not stale
    const result = detectStaleNodes({ maxAgeDays: 60, protectReferenced: true });
    expect(result.staled).toHaveLength(0);
  });

  it('filters by namespace', () => {
    const node = createNode({ namespace: 'a', content: 'old in a' });
    createNode({ namespace: 'b', content: 'old in b' });
    const db = getDatabase();
    db.prepare("UPDATE nodes SET updated_at = datetime('now', '-90 days') WHERE 1=1").run();

    const result = detectStaleNodes({ maxAgeDays: 60, namespace: 'a' });
    expect(result.staled).toHaveLength(1);
    expect(result.staled[0]).toBe(node.id);
  });
});
