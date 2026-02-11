import { describe, it, expect } from 'vitest';
import { buildCompactionPrompt } from '../../src/core/summarize.js';
import type { Node } from '../../src/core/nodes.js';

// Only test the prompt building (no API call in tests)
// API integration is tested in smoke tests

const mockNodes: Node[] = [
  {
    id: 'kt-aaa111', namespace: 'test', title: 'Pricing decision',
    content: 'Client X chose three-tier pricing: basic, pro, enterprise.',
    status: 'stale', source_type: 'capture', tags: ['pricing'],
    embedding_pending: false, compacted_into: null,
    created_at: '2026-01-15', updated_at: '2026-01-15',
    stale_at: '2026-02-10', session_id: null,
  },
  {
    id: 'kt-bbb222', namespace: 'test', title: 'Pricing refinement',
    content: 'Basic tier dropped. Now two tiers: pro ($5k/mo) and enterprise ($15k/mo).',
    status: 'stale', source_type: 'capture', tags: ['pricing'],
    embedding_pending: false, compacted_into: null,
    created_at: '2026-01-20', updated_at: '2026-01-20',
    stale_at: '2026-02-10', session_id: null,
  },
  {
    id: 'kt-ccc333', namespace: 'test', title: 'Enterprise tier details',
    content: 'Enterprise includes dedicated advisory, weekly syncs, custom reporting.',
    status: 'stale', source_type: 'capture', tags: ['pricing'],
    embedding_pending: false, compacted_into: null,
    created_at: '2026-01-25', updated_at: '2026-01-25',
    stale_at: '2026-02-10', session_id: null,
  },
];

describe('summarize', () => {
  describe('buildCompactionPrompt', () => {
    it('includes all node contents in chronological order', () => {
      const prompt = buildCompactionPrompt(mockNodes);
      expect(prompt).toContain('Pricing decision');
      expect(prompt).toContain('Pricing refinement');
      expect(prompt).toContain('Enterprise tier details');
      // Chronological: aaa before bbb before ccc
      const idxA = prompt.indexOf('kt-aaa111');
      const idxB = prompt.indexOf('kt-bbb222');
      const idxC = prompt.indexOf('kt-ccc333');
      expect(idxA).toBeLessThan(idxB);
      expect(idxB).toBeLessThan(idxC);
    });

    it('instructs Claude to preserve decisions and rationale', () => {
      const prompt = buildCompactionPrompt(mockNodes);
      expect(prompt.toLowerCase()).toContain('decision');
      expect(prompt.toLowerCase()).toContain('rationale');
    });

    it('asks for concise output', () => {
      const prompt = buildCompactionPrompt(mockNodes);
      expect(prompt.toLowerCase()).toContain('concise');
    });
  });
});
