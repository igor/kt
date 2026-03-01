import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, closeDatabase } from '../../src/db/connection.js';
import { createNamespace } from '../../src/core/namespaces.js';
import { addMapping, resolveNamespace, resolveNamespaceFromVault, listMappings } from '../../src/core/mappings.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('project mappings', () => {
  const testDir = path.join(os.tmpdir(), 'kt-test-map-' + Date.now());
  const testDb = path.join(testDir, 'kt.db');

  beforeEach(() => {
    createDatabase(testDb);
    createNamespace('ep-advisory', 'EP Advisory');
    createNamespace('clients', 'Clients');
  });

  afterEach(() => { closeDatabase(); fs.rmSync(testDir, { recursive: true, force: true }); });

  it('maps a directory pattern to a namespace', () => {
    addMapping('~/GitHub/ep-advisory/*', 'ep-advisory');
    const mappings = listMappings();
    expect(mappings).toHaveLength(1);
    expect(mappings[0].namespace).toBe('ep-advisory');
  });

  it('resolves a directory to a namespace', () => {
    addMapping('/Users/zeigor/GitHub/ep-advisory', 'ep-advisory');
    const ns = resolveNamespace('/Users/zeigor/GitHub/ep-advisory/src/index.ts');
    expect(ns).toBe('ep-advisory');
  });

  it('returns null for unmapped directory', () => {
    const ns = resolveNamespace('/Users/zeigor/random/path');
    expect(ns).toBeNull();
  });

  it('matches longest prefix', () => {
    addMapping('/Users/zeigor/GitHub', 'clients');
    addMapping('/Users/zeigor/GitHub/ep-advisory', 'ep-advisory');
    const ns = resolveNamespace('/Users/zeigor/GitHub/ep-advisory/docs');
    expect(ns).toBe('ep-advisory');
  });
});

describe('vault-local resolution', () => {
  it('derives namespace from relative path to vault root', () => {
    const ns = resolveNamespaceFromVault(
      '/path/to/vault/clients/google',
      '/path/to/vault'
    );
    expect(ns).toBe('clients.google');
  });

  it('caps at 3 levels', () => {
    const ns = resolveNamespaceFromVault(
      '/path/to/vault/clients/google/workshop/day-1',
      '/path/to/vault'
    );
    expect(ns).toBe('clients.google.workshop');
  });

  it('returns null at vault root', () => {
    const ns = resolveNamespaceFromVault(
      '/path/to/vault',
      '/path/to/vault'
    );
    expect(ns).toBeNull();
  });

  it('handles single level', () => {
    const ns = resolveNamespaceFromVault(
      '/path/to/vault/clients',
      '/path/to/vault'
    );
    expect(ns).toBe('clients');
  });
});
