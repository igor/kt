import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDatabase, closeDatabase, getDatabase } from '../../src/db/connection.js';
import { createNode, getNode, listNodes, updateNodeStatus } from '../../src/core/nodes.js';
import { createLink } from '../../src/core/links.js';
import { compactCluster, dryRunCompaction, type CompactionPlan, type CompactionResult } from '../../src/core/compact.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock the summarize function to avoid API calls in tests
vi.mock('../../src/core/summarize.js', () => ({
  summarizeCluster: vi.fn().mockResolvedValue('Summary of compacted nodes: pricing is two-tier, pro and enterprise.'),
  buildCompactionPrompt: vi.fn().mockReturnValue('mock prompt'),
}));

describe('compaction', () => {
  const testDir = path.join(os.tmpdir(), 'kt-test-compact-' + Date.now());
  const testDb = path.join(testDir, 'kt.db');

  beforeEach(() => createDatabase(testDb));
  afterEach(() => { closeDatabase(); fs.rmSync(testDir, { recursive: true, force: true }); });

  describe('dryRunCompaction', () => {
    it('returns clusters without modifying anything', () => {
      const a = createNode({ namespace: 'test', content: 'node a' });
      const b = createNode({ namespace: 'test', content: 'node b' });
      const c = createNode({ namespace: 'test', content: 'node c' });

      createLink(a.id, 'related', b.id);
      createLink(b.id, 'related', c.id);

      updateNodeStatus(a.id, 'stale');
      updateNodeStatus(b.id, 'stale');
      updateNodeStatus(c.id, 'stale');

      const plan = dryRunCompaction({ namespace: 'test', minClusterSize: 2 });
      expect(plan.clusters).toHaveLength(1);
      expect(plan.clusters[0].nodeIds).toHaveLength(3);

      // Nothing should be modified
      expect(getNode(a.id)!.status).toBe('stale');
    });
  });

  describe('compactCluster', () => {
    it('creates a summary node and marks originals as compacted', async () => {
      const a = createNode({ namespace: 'test', content: 'pricing tier one', title: 'Tier 1' });
      const b = createNode({ namespace: 'test', content: 'pricing tier two', title: 'Tier 2' });
      const c = createNode({ namespace: 'test', content: 'pricing tier three', title: 'Tier 3' });

      createLink(a.id, 'related', b.id);
      createLink(b.id, 'related', c.id);

      updateNodeStatus(a.id, 'stale');
      updateNodeStatus(b.id, 'stale');
      updateNodeStatus(c.id, 'stale');

      const result = await compactCluster({
        nodeIds: [a.id, b.id, c.id],
        namespace: 'test',
      });

      expect(result).not.toBeNull();
      expect(result!.summaryNode.source_type).toBe('compaction');
      expect(result!.summaryNode.status).toBe('active');
      expect(result!.compactedIds).toHaveLength(3);

      // Originals should be compacted
      expect(getNode(a.id)!.status).toBe('compacted');
      expect(getNode(b.id)!.status).toBe('compacted');
      expect(getNode(c.id)!.status).toBe('compacted');

      // Originals should point to summary
      expect(getNode(a.id)!.compacted_into).toBe(result!.summaryNode.id);
    });

    it('re-points inbound links from originals to summary', async () => {
      const a = createNode({ namespace: 'test', content: 'will be compacted' });
      const b = createNode({ namespace: 'test', content: 'also compacted' });
      const c = createNode({ namespace: 'test', content: 'also compacted too' });
      const external = createNode({ namespace: 'test', content: 'links to a' });

      createLink(a.id, 'related', b.id);
      createLink(b.id, 'related', c.id);
      createLink(external.id, 'related', a.id);

      updateNodeStatus(a.id, 'stale');
      updateNodeStatus(b.id, 'stale');
      updateNodeStatus(c.id, 'stale');

      const result = await compactCluster({
        nodeIds: [a.id, b.id, c.id],
        namespace: 'test',
      });

      // The external link should now point to the summary node
      const db = getDatabase();
      const link = db.prepare(
        'SELECT target_id FROM links WHERE source_id = ? AND link_type = ?'
      ).get(external.id, 'related') as { target_id: string };
      expect(link.target_id).toBe(result!.summaryNode.id);
    });
  });
});
