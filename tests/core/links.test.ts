import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, closeDatabase } from '../../src/db/connection.js';
import { createNode, getNode } from '../../src/core/nodes.js';
import { createLink, getLinks, getBacklinks } from '../../src/core/links.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('links', () => {
  const testDir = path.join(os.tmpdir(), 'kt-test-links-' + Date.now());
  const testDb = path.join(testDir, 'kt.db');

  beforeEach(() => {
    createDatabase(testDb);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('creates a related link between two nodes', () => {
    const a = createNode({ namespace: 'test', content: 'node a' });
    const b = createNode({ namespace: 'test', content: 'node b' });

    const link = createLink(a.id, 'related', b.id);
    expect(link.link_type).toBe('related');
    expect(link.source_id).toBe(a.id);
    expect(link.target_id).toBe(b.id);
  });

  it('supersedes link marks target as stale', () => {
    const old = createNode({ namespace: 'test', content: 'old insight' });
    const updated = createNode({ namespace: 'test', content: 'new insight' });

    createLink(updated.id, 'supersedes', old.id);

    const staleNode = getNode(old.id);
    expect(staleNode!.status).toBe('stale');
    expect(staleNode!.stale_at).toBeDefined();
  });

  it('contradicts link does NOT auto-stale either node', () => {
    const a = createNode({ namespace: 'test', content: 'view A' });
    const b = createNode({ namespace: 'test', content: 'view B' });

    createLink(a.id, 'contradicts', b.id);

    expect(getNode(a.id)!.status).toBe('active');
    expect(getNode(b.id)!.status).toBe('active');
  });

  it('gets outbound links for a node', () => {
    const a = createNode({ namespace: 'test', content: 'node a' });
    const b = createNode({ namespace: 'test', content: 'node b' });
    const c = createNode({ namespace: 'test', content: 'node c' });

    createLink(a.id, 'related', b.id);
    createLink(a.id, 'related', c.id);

    const links = getLinks(a.id);
    expect(links).toHaveLength(2);
  });

  it('gets backlinks for a node', () => {
    const a = createNode({ namespace: 'test', content: 'node a' });
    const b = createNode({ namespace: 'test', content: 'node b' });

    createLink(a.id, 'related', b.id);

    const backlinks = getBacklinks(b.id);
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].source_id).toBe(a.id);
  });
});
