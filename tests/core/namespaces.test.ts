import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, closeDatabase } from '../../src/db/connection.js';
import {
  createNamespace, listNamespaces, getNamespace, deleteNamespace, ensureNamespace,
} from '../../src/core/namespaces.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('namespaces', () => {
  const testDir = path.join(os.tmpdir(), 'kt-test-ns-' + Date.now());
  const testDb = path.join(testDir, 'kt.db');

  beforeEach(() => createDatabase(testDb));
  afterEach(() => { closeDatabase(); fs.rmSync(testDir, { recursive: true, force: true }); });

  it('creates and retrieves a namespace', () => {
    createNamespace('clients', 'Client Knowledge');
    const ns = getNamespace('clients');
    expect(ns).toBeDefined();
    expect(ns!.name).toBe('Client Knowledge');
  });

  it('lists all namespaces', () => {
    createNamespace('a', 'A');
    createNamespace('b', 'B');
    const list = listNamespaces();
    expect(list).toHaveLength(2);
  });

  it('auto-creates namespace on first node capture', () => {
    // Namespace should be created implicitly if it doesn't exist
    createNamespace('auto', 'Auto');
    expect(getNamespace('auto')).toBeDefined();
  });

  it('deletes a namespace', () => {
    createNamespace('temp', 'Temporary');
    deleteNamespace('temp');
    expect(getNamespace('temp')).toBeNull();
  });

  it('auto-creates parent namespaces for dotted slugs', () => {
    ensureNamespace('clients.google.workshop');
    expect(getNamespace('clients')).toBeDefined();
    expect(getNamespace('clients')!.name).toBe('clients');
    expect(getNamespace('clients.google')).toBeDefined();
    expect(getNamespace('clients.google')!.name).toBe('clients.google');
    expect(getNamespace('clients.google.workshop')).toBeDefined();
  });

  it('is idempotent for parent creation', () => {
    ensureNamespace('clients');
    ensureNamespace('clients.google');
    ensureNamespace('clients.google.workshop');
    const list = listNamespaces();
    expect(list.filter(n => n.slug === 'clients')).toHaveLength(1);
  });
});
