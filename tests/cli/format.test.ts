import { describe, it, expect } from 'vitest';
import { formatNode, formatNodeList, formatNodeBrief, detectFormat } from '../../src/cli/format.js';
import type { Node } from '../../src/core/nodes.js';

const mockNode: Node = {
  id: 'kt-a1b2c3',
  namespace: 'test',
  title: 'Test Node',
  content: 'This is test content for formatting',
  status: 'active',
  source_type: 'capture',
  tags: ['tag1', 'tag2'],
  embedding_pending: false,
  compacted_into: null,
  created_at: '2026-02-10 14:00:00',
  updated_at: '2026-02-10 14:00:00',
  stale_at: null,
  session_id: null,
};

describe('format', () => {
  describe('formatNode JSON', () => {
    it('returns valid JSON', () => {
      const output = formatNode(mockNode, 'json');
      const parsed = JSON.parse(output);
      expect(parsed.id).toBe('kt-a1b2c3');
    });
  });

  describe('formatNode human', () => {
    it('includes ID, title, and content', () => {
      const output = formatNode(mockNode, 'human');
      expect(output).toContain('kt-a1b2c3');
      expect(output).toContain('Test Node');
      expect(output).toContain('This is test content');
    });
  });

  describe('formatNodeBrief', () => {
    it('returns one-line summary', () => {
      const output = formatNodeBrief(mockNode);
      expect(output).toContain('kt-a1b2c3');
      expect(output).toContain('Test Node');
      expect(output.split('\n')).toHaveLength(1);
    });
  });

  describe('formatNodeList JSON', () => {
    it('returns JSON array', () => {
      const output = formatNodeList([mockNode, mockNode], 'json');
      const parsed = JSON.parse(output);
      expect(parsed).toHaveLength(2);
    });
  });

  describe('detectFormat', () => {
    it('returns json when not a TTY', () => {
      expect(detectFormat(false)).toBe('json');
    });

    it('returns human when TTY', () => {
      expect(detectFormat(true)).toBe('human');
    });
  });
});
