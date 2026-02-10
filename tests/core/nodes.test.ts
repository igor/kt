import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, closeDatabase } from '../../src/db/connection.js';
import { createNode, getNode, listNodes, updateNodeStatus, deleteNode } from '../../src/core/nodes.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('nodes', () => {
  const testDir = path.join(os.tmpdir(), 'kt-test-nodes-' + Date.now());
  const testDb = path.join(testDir, 'kt.db');

  beforeEach(() => {
    createDatabase(testDb);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('createNode', () => {
    it('creates a node and returns it with an ID', () => {
      const node = createNode({
        namespace: 'test',
        content: 'Client X prefers quarterly planning',
        title: 'Client X planning preference',
      });

      expect(node.id).toMatch(/^kt-/);
      expect(node.namespace).toBe('test');
      expect(node.content).toBe('Client X prefers quarterly planning');
      expect(node.status).toBe('active');
      expect(node.source_type).toBe('capture');
    });

    it('creates a node with tags', () => {
      const node = createNode({
        namespace: 'test',
        content: 'Some insight',
        tags: ['pricing', 'client-x'],
      });

      expect(node.tags).toEqual(['pricing', 'client-x']);
    });
  });

  describe('getNode', () => {
    it('retrieves a node by ID', () => {
      const created = createNode({
        namespace: 'test',
        content: 'Some content',
      });

      const fetched = getNode(created.id);
      expect(fetched).toBeDefined();
      expect(fetched!.content).toBe('Some content');
    });

    it('returns null for non-existent ID', () => {
      const result = getNode('kt-000000');
      expect(result).toBeNull();
    });
  });

  describe('listNodes', () => {
    it('lists nodes filtered by namespace', () => {
      createNode({ namespace: 'a', content: 'node in a' });
      createNode({ namespace: 'b', content: 'node in b' });
      createNode({ namespace: 'a', content: 'another in a' });

      const result = listNodes({ namespace: 'a' });
      expect(result).toHaveLength(2);
    });

    it('excludes compacted nodes by default', () => {
      const node = createNode({ namespace: 'test', content: 'old stuff' });
      updateNodeStatus(node.id, 'compacted');

      const result = listNodes({ namespace: 'test' });
      expect(result).toHaveLength(0);
    });

    it('includes compacted nodes when requested', () => {
      const node = createNode({ namespace: 'test', content: 'old stuff' });
      updateNodeStatus(node.id, 'compacted');

      const result = listNodes({ namespace: 'test', includeCompacted: true });
      expect(result).toHaveLength(1);
    });
  });

  describe('updateNodeStatus', () => {
    it('transitions active to stale', () => {
      const node = createNode({ namespace: 'test', content: 'content' });
      updateNodeStatus(node.id, 'stale');

      const updated = getNode(node.id);
      expect(updated!.status).toBe('stale');
      expect(updated!.stale_at).toBeDefined();
    });

    it('transitions stale back to active', () => {
      const node = createNode({ namespace: 'test', content: 'content' });
      updateNodeStatus(node.id, 'stale');
      updateNodeStatus(node.id, 'active');

      const updated = getNode(node.id);
      expect(updated!.status).toBe('active');
      expect(updated!.stale_at).toBeNull();
    });
  });

  describe('deleteNode', () => {
    it('removes a node', () => {
      const node = createNode({ namespace: 'test', content: 'content' });
      deleteNode(node.id);

      const result = getNode(node.id);
      expect(result).toBeNull();
    });
  });
});
