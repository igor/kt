import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDatabase, closeDatabase } from '../../src/db/connection.js';
import { ensureNamespace } from '../../src/core/namespaces.js';
import { createNode } from '../../src/core/nodes.js';
import { handleSearch, handleCapture, handleContext, handleShow, handleListNamespaces } from '../../src/mcp/tools.js';

const testDir = path.join(os.tmpdir(), 'kt-test-mcp-tools-' + Date.now());
const testDb = path.join(testDir, 'kt.db');

beforeEach(() => {
  fs.mkdirSync(testDir, { recursive: true });
  createDatabase(testDb);
  ensureNamespace('test-ns');
});

afterEach(() => {
  closeDatabase();
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('MCP tool handlers', () => {
  describe('handleSearch', () => {
    it('returns matching nodes', () => {
      createNode({ namespace: 'test-ns', content: 'Tailscale networking guide', title: 'Tailscale' });
      const result = handleSearch({ query: 'Tailscale' });
      expect(result.content[0].type).toBe('text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].title).toBe('Tailscale');
    });

    it('filters by namespace', () => {
      ensureNamespace('other-ns');
      createNode({ namespace: 'test-ns', content: 'alpha content', title: 'Alpha' });
      createNode({ namespace: 'other-ns', content: 'alpha other', title: 'Alpha Other' });
      const result = handleSearch({ query: 'alpha', namespace: 'test-ns' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].namespace).toBe('test-ns');
    });

    it('returns empty array for no matches', () => {
      const result = handleSearch({ query: 'nonexistent' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results).toHaveLength(0);
    });
  });

  describe('handleCapture', () => {
    it('creates a node and returns it', () => {
      const result = handleCapture({
        content: 'Test knowledge capture',
        title: 'Test Capture',
        namespace: 'test-ns',
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.node.id).toMatch(/^kt-/);
      expect(parsed.node.title).toBe('Test Capture');
      expect(parsed.node.namespace).toBe('test-ns');
    });

    it('uses default namespace when not specified', () => {
      ensureNamespace('default');
      const result = handleCapture({
        content: 'No namespace specified',
        title: 'Default NS',
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.node.namespace).toBe('default');
    });
  });

  describe('handleContext', () => {
    it('returns context brief for namespace', () => {
      createNode({ namespace: 'test-ns', content: 'Context content', title: 'Context Node' });
      const result = handleContext({ namespace: 'test-ns' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.namespace).toBe('test-ns');
      expect(parsed.total_nodes).toBeGreaterThanOrEqual(1);
      expect(parsed.active_nodes).toBeInstanceOf(Array);
    });
  });

  describe('handleShow', () => {
    it('returns node details', () => {
      const node = createNode({ namespace: 'test-ns', content: 'Show me', title: 'Showable' });
      const result = handleShow({ id: node.id });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.node.id).toBe(node.id);
      expect(parsed.node.content).toBe('Show me');
    });

    it('returns error for missing node', () => {
      const result = handleShow({ id: 'kt-nonexistent' });
      expect(result.isError).toBe(true);
    });
  });

  describe('handleListNamespaces', () => {
    it('returns all namespaces', () => {
      ensureNamespace('ns-a');
      ensureNamespace('ns-b');
      const result = handleListNamespaces();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.namespaces.length).toBeGreaterThanOrEqual(2);
    });
  });
});
