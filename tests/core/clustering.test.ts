import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, closeDatabase, getDatabase } from '../../src/db/connection.js';
import { createNode, updateNodeStatus } from '../../src/core/nodes.js';
import { createLink } from '../../src/core/links.js';
import { insertEmbedding } from '../../src/db/vec.js';
import { detectClusters, type Cluster } from '../../src/core/clustering.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('cluster detection', () => {
  const testDir = path.join(os.tmpdir(), 'kt-test-cluster-' + Date.now());
  const testDb = path.join(testDir, 'kt.db');

  beforeEach(() => createDatabase(testDb));
  afterEach(() => { closeDatabase(); fs.rmSync(testDir, { recursive: true, force: true }); });

  it('groups linked stale nodes into a cluster', () => {
    const a = createNode({ namespace: 'test', content: 'node a' });
    const b = createNode({ namespace: 'test', content: 'node b' });
    const c = createNode({ namespace: 'test', content: 'node c' });

    createLink(a.id, 'related', b.id);
    createLink(b.id, 'related', c.id);

    // Mark all as stale
    updateNodeStatus(a.id, 'stale');
    updateNodeStatus(b.id, 'stale');
    updateNodeStatus(c.id, 'stale');

    const clusters = detectClusters({ namespace: 'test', minClusterSize: 2 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].nodeIds).toHaveLength(3);
  });

  it('creates separate clusters for disconnected groups', () => {
    const a = createNode({ namespace: 'test', content: 'group 1 a' });
    const b = createNode({ namespace: 'test', content: 'group 1 b' });
    const c = createNode({ namespace: 'test', content: 'group 2 c' });
    const d = createNode({ namespace: 'test', content: 'group 2 d' });

    createLink(a.id, 'related', b.id);
    createLink(c.id, 'related', d.id);
    // No link between groups

    updateNodeStatus(a.id, 'stale');
    updateNodeStatus(b.id, 'stale');
    updateNodeStatus(c.id, 'stale');
    updateNodeStatus(d.id, 'stale');

    const clusters = detectClusters({ namespace: 'test', minClusterSize: 2 });
    expect(clusters).toHaveLength(2);
  });

  it('respects minimum cluster size', () => {
    const a = createNode({ namespace: 'test', content: 'lone stale node' });
    updateNodeStatus(a.id, 'stale');

    const clusters = detectClusters({ namespace: 'test', minClusterSize: 2 });
    expect(clusters).toHaveLength(0);
  });

  it('groups semantically similar stale nodes even without links', () => {
    const a = createNode({ namespace: 'test', content: 'pricing model tier one' });
    const b = createNode({ namespace: 'test', content: 'pricing model tier two' });
    const c = createNode({ namespace: 'test', content: 'completely unrelated content' });

    // Similar embeddings for a and b
    const embA = new Float32Array(768).fill(0);
    embA[0] = 0.9; embA[1] = 0.8;
    const embB = new Float32Array(768).fill(0);
    embB[0] = 0.88; embB[1] = 0.78;
    const embC = new Float32Array(768).fill(0);
    embC[0] = 0.1; embC[1] = 0.1; embC[2] = 0.9;

    insertEmbedding(a.id, embA);
    insertEmbedding(b.id, embB);
    insertEmbedding(c.id, embC);

    updateNodeStatus(a.id, 'stale');
    updateNodeStatus(b.id, 'stale');
    updateNodeStatus(c.id, 'stale');

    const clusters = detectClusters({
      namespace: 'test',
      minClusterSize: 2,
      semanticThreshold: 0.5,
    });

    // a and b should cluster; c should be separate (won't meet min size alone)
    expect(clusters).toHaveLength(1);
    expect(clusters[0].nodeIds).toContain(a.id);
    expect(clusters[0].nodeIds).toContain(b.id);
    expect(clusters[0].nodeIds).not.toContain(c.id);
  });

  it('filters by namespace', () => {
    const a = createNode({ namespace: 'a', content: 'ns a node 1' });
    const b = createNode({ namespace: 'a', content: 'ns a node 2' });
    const c = createNode({ namespace: 'b', content: 'ns b node 1' });
    const d = createNode({ namespace: 'b', content: 'ns b node 2' });

    createLink(a.id, 'related', b.id);
    createLink(c.id, 'related', d.id);

    [a, b, c, d].forEach(n => updateNodeStatus(n.id, 'stale'));

    const clusters = detectClusters({ namespace: 'a', minClusterSize: 2 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].nodeIds).toContain(a.id);
    expect(clusters[0].nodeIds).not.toContain(c.id);
  });
});
