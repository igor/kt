import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createDatabase, closeDatabase, getDatabase, resolveDatabase } from '../../src/db/connection.js';
import { resolveNamespaceFromVault } from '../../src/core/mappings.js';
import { ensureNamespace, listNamespaces } from '../../src/core/namespaces.js';
import { createNode } from '../../src/core/nodes.js';
import { searchNodes } from '../../src/core/search.js';
import { listNodes } from '../../src/core/nodes.js';

describe('vault workflow', () => {
  const testDir = path.join(os.tmpdir(), 'kt-vault-test-' + Date.now());
  const vaultDir = path.join(testDir, 'my-vault');
  const clientsDir = path.join(vaultDir, 'clients');
  const googleDir = path.join(clientsDir, 'google');
  const deepDir = path.join(googleDir, 'q1', 'workshop');

  beforeEach(() => {
    fs.mkdirSync(deepDir, { recursive: true });
    // Simulate kt init: create .kt dir with database
    const ktDir = path.join(vaultDir, '.kt');
    fs.mkdirSync(ktDir, { recursive: true });
    createDatabase(path.join(ktDir, 'kt.db'), vaultDir);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('resolveDatabase finds vault .kt from subdirectory', () => {
    const result = resolveDatabase(googleDir);
    expect(result.dbPath).toBe(path.join(vaultDir, '.kt', 'kt.db'));
    expect(result.vaultRoot).toBe(vaultDir);
  });

  it('derives namespace from folder depth', () => {
    const ns = resolveNamespaceFromVault(googleDir, vaultDir);
    expect(ns).toBe('clients.google');
  });

  it('caps namespace at 3 levels', () => {
    const ns = resolveNamespaceFromVault(deepDir, vaultDir);
    expect(ns).toBe('clients.google.q1');
  });

  it('captures into auto-derived namespace', () => {
    const ns = resolveNamespaceFromVault(googleDir, vaultDir)!;
    ensureNamespace(ns);
    const node = createNode({ namespace: ns, content: 'Google insight about branding' });
    expect(node.namespace).toBe('clients.google');
  });

  it('auto-creates parent namespaces on capture', () => {
    const ns = resolveNamespaceFromVault(googleDir, vaultDir)!;
    ensureNamespace(ns);
    createNode({ namespace: ns, content: 'Google insight' });

    const nsList = listNamespaces();
    const slugs = nsList.map(n => n.slug);
    expect(slugs).toContain('clients');
    expect(slugs).toContain('clients.google');
  });

  it('search from parent includes child namespaces', () => {
    // Create nodes in child namespaces
    ensureNamespace('clients.google');
    ensureNamespace('clients.hpi');
    ensureNamespace('other');
    createNode({ namespace: 'clients.google', content: 'Google insight about branding' });
    createNode({ namespace: 'clients.hpi', content: 'HPI insight about research' });
    createNode({ namespace: 'other', content: 'Unrelated insight' });

    // Search from parent should find both children
    const results = searchNodes('insight', { namespace: 'clients' });
    expect(results).toHaveLength(2);
    expect(results.every(r => r.namespace.startsWith('clients'))).toBe(true);
  });

  it('search from child does not include parent', () => {
    ensureNamespace('clients');
    ensureNamespace('clients.google');
    createNode({ namespace: 'clients', content: 'Top-level clients note' });
    createNode({ namespace: 'clients.google', content: 'Google-specific note' });

    const results = searchNodes('note', { namespace: 'clients.google' });
    expect(results.every(r => r.namespace === 'clients.google')).toBe(true);
  });

  it('context from vault root shows all namespaces', () => {
    ensureNamespace('clients');
    ensureNamespace('clients.google');
    createNode({ namespace: 'clients', content: 'Client insight' });
    createNode({ namespace: 'clients.google', content: 'Google insight' });

    // No namespace filter = all nodes
    const allNodes = listNodes({ status: 'active' });
    expect(allNodes).toHaveLength(2);
  });
});
