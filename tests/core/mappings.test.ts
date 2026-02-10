import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, closeDatabase } from '../../src/db/connection.js';
import { createNamespace } from '../../src/core/namespaces.js';
import { addMapping, resolveNamespace, listMappings } from '../../src/core/mappings.js';
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
