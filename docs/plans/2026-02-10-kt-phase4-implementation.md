# Knowledge Tracker (kt) — Phase 4: Compaction Pipeline

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a compaction pipeline that detects stale knowledge, groups related nodes into clusters, summarizes them via Claude, and replaces the cluster with a single dense summary node — keeping the knowledge base clean over time.

**Architecture:** Three-pass pipeline: (1) staleness detection marks old/superseded nodes as stale, (2) cluster detection groups stale nodes by link graph and semantic similarity, (3) compaction sends each cluster to Claude for summarization, creates a summary node, and marks originals as compacted. All orchestrated via `kt compact` CLI command with `--dry-run` for preview.

**Tech Stack:** @anthropic-ai/sdk (Claude API for summarization), existing sqlite-vec for clustering, vitest

**Reference:** Design doc at `docs/plans/2026-02-10-knowledge-tracker-design.md`, current code in `src/`

**Important context for implementer:**
- Project at `~/GitHub/kt/`, ESM (`"type": "module"`), TypeScript strict mode
- Database: better-sqlite3 (sync) + sqlite-vec, WAL mode
- Existing status transitions: `active → stale → compacted` via `updateNodeStatus()` in `src/core/nodes.ts:98`
- `compacted_into` field on nodes already exists (set to null, ready for Phase 4)
- Link types: `supersedes` (auto-stales target), `contradicts`, `related`
- Embeddings: Ollama `nomic-embed-text` (768-dim), stored in `node_embeddings` vec0 table
- Test pattern: temp DB per test in `os.tmpdir()`, vitest, cleanup in `afterEach`
- Async commands use `program.parseAsync()` in `src/index.ts`
- The `ANTHROPIC_API_KEY` env var is needed for Claude summarization. The compaction command should fail gracefully if it's missing.

---

### Task 1: Install Anthropic SDK

**Files:**
- Modify: `package.json`

**Step 1: Install the SDK**

```bash
cd ~/GitHub/kt && npm install @anthropic-ai/sdk
```

**Step 2: Verify it installed**

```bash
node -e "import('@anthropic-ai/sdk').then(m => console.log('ok'))"
```

Expected: `ok`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @anthropic-ai/sdk for compaction summarization"
```

---

### Task 2: Staleness Detection

Scan active nodes and mark stale ones based on age and link signals. This is Pass 1 of the compaction pipeline.

**Files:**
- Create: `src/core/staleness.ts`
- Create: `tests/core/staleness.test.ts`

**Step 1: Write the failing test**

`tests/core/staleness.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, closeDatabase, getDatabase } from '../../src/db/connection.js';
import { createNode, getNode } from '../../src/core/nodes.js';
import { createLink } from '../../src/core/links.js';
import { detectStaleNodes } from '../../src/core/staleness.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('staleness detection', () => {
  const testDir = path.join(os.tmpdir(), 'kt-test-stale-' + Date.now());
  const testDb = path.join(testDir, 'kt.db');

  beforeEach(() => createDatabase(testDb));
  afterEach(() => { closeDatabase(); fs.rmSync(testDir, { recursive: true, force: true }); });

  it('marks nodes as stale when they exceed age threshold', () => {
    const node = createNode({ namespace: 'test', content: 'old knowledge' });

    // Manually backdate the node to 90 days ago
    const db = getDatabase();
    db.prepare("UPDATE nodes SET updated_at = datetime('now', '-90 days'), created_at = datetime('now', '-90 days') WHERE id = ?").run(node.id);

    const result = detectStaleNodes({ maxAgeDays: 60 });
    expect(result.staled).toHaveLength(1);
    expect(result.staled[0]).toBe(node.id);

    const updated = getNode(node.id);
    expect(updated!.status).toBe('stale');
  });

  it('does not mark recent nodes as stale', () => {
    createNode({ namespace: 'test', content: 'fresh knowledge' });

    const result = detectStaleNodes({ maxAgeDays: 60 });
    expect(result.staled).toHaveLength(0);
  });

  it('does not re-stale already stale nodes', () => {
    const node = createNode({ namespace: 'test', content: 'already stale' });
    const db = getDatabase();
    db.prepare("UPDATE nodes SET status = 'stale', stale_at = datetime('now'), updated_at = datetime('now', '-90 days') WHERE id = ?").run(node.id);

    const result = detectStaleNodes({ maxAgeDays: 60 });
    expect(result.staled).toHaveLength(0);
  });

  it('marks nodes with unlinked low activity as stale', () => {
    const node = createNode({ namespace: 'test', content: 'orphan node' });
    const db = getDatabase();
    // 45 days old, no links
    db.prepare("UPDATE nodes SET updated_at = datetime('now', '-45 days'), created_at = datetime('now', '-45 days') WHERE id = ?").run(node.id);

    const result = detectStaleNodes({ maxAgeDays: 60, orphanAgeDays: 30 });
    expect(result.staled).toHaveLength(1);
  });

  it('does not stale old nodes that have recent inbound links', () => {
    const old = createNode({ namespace: 'test', content: 'old but referenced' });
    const recent = createNode({ namespace: 'test', content: 'recent node' });
    const db = getDatabase();
    db.prepare("UPDATE nodes SET updated_at = datetime('now', '-90 days'), created_at = datetime('now', '-90 days') WHERE id = ?").run(old.id);

    // Recent node links to old node — old node is still relevant
    createLink(recent.id, 'related', old.id);

    // With reference protection on, should not stale
    const result = detectStaleNodes({ maxAgeDays: 60, protectReferenced: true });
    expect(result.staled).toHaveLength(0);
  });

  it('filters by namespace', () => {
    const node = createNode({ namespace: 'a', content: 'old in a' });
    createNode({ namespace: 'b', content: 'old in b' });
    const db = getDatabase();
    db.prepare("UPDATE nodes SET updated_at = datetime('now', '-90 days') WHERE 1=1").run();

    const result = detectStaleNodes({ maxAgeDays: 60, namespace: 'a' });
    expect(result.staled).toHaveLength(1);
    expect(result.staled[0]).toBe(node.id);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/core/staleness.test.ts
```

Expected: FAIL — module not found

**Step 3: Implement staleness detection**

`src/core/staleness.ts`:
```typescript
import { getDatabase } from '../db/connection.js';
import { updateNodeStatus } from './nodes.js';

interface DetectStaleOptions {
  maxAgeDays?: number;
  orphanAgeDays?: number;
  namespace?: string;
  protectReferenced?: boolean;
}

interface DetectStaleResult {
  staled: string[];
  skipped: number;
}

export function detectStaleNodes(options: DetectStaleOptions = {}): DetectStaleResult {
  const db = getDatabase();
  const maxAgeDays = options.maxAgeDays ?? 60;
  const orphanAgeDays = options.orphanAgeDays ?? maxAgeDays;
  const protectReferenced = options.protectReferenced ?? false;

  const staled: string[] = [];
  let skipped = 0;

  // Find active nodes older than threshold
  const conditions: string[] = [
    "status = 'active'",
    `updated_at < datetime('now', '-${maxAgeDays} days')`,
  ];
  const params: any[] = [];

  if (options.namespace) {
    conditions.push('namespace = ?');
    params.push(options.namespace);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const candidates = db.prepare(`SELECT id FROM nodes ${where}`).all(...params) as { id: string }[];

  for (const candidate of candidates) {
    // Check if protected by recent references
    if (protectReferenced) {
      const recentLinks = db.prepare(`
        SELECT COUNT(*) as c FROM links
        WHERE target_id = ? AND created_at > datetime('now', '-${maxAgeDays} days')
      `).get(candidate.id) as { c: number };

      if (recentLinks.c > 0) {
        skipped++;
        continue;
      }
    }

    updateNodeStatus(candidate.id, 'stale');
    staled.push(candidate.id);
  }

  // Also check orphan nodes (no inbound links, older than orphanAgeDays)
  if (orphanAgeDays < maxAgeDays) {
    const orphanConditions: string[] = [
      "n.status = 'active'",
      `n.updated_at < datetime('now', '-${orphanAgeDays} days')`,
      `n.updated_at >= datetime('now', '-${maxAgeDays} days')`,
    ];

    if (options.namespace) {
      orphanConditions.push('n.namespace = ?');
    }

    const orphanWhere = `WHERE ${orphanConditions.join(' AND ')}`;
    const orphanQuery = `
      SELECT n.id FROM nodes n
      LEFT JOIN links l ON l.target_id = n.id
      ${orphanWhere}
      GROUP BY n.id
      HAVING COUNT(l.id) = 0
    `;

    const orphans = options.namespace
      ? db.prepare(orphanQuery).all(options.namespace) as { id: string }[]
      : db.prepare(orphanQuery).all() as { id: string }[];

    for (const orphan of orphans) {
      if (!staled.includes(orphan.id)) {
        updateNodeStatus(orphan.id, 'stale');
        staled.push(orphan.id);
      }
    }
  }

  return { staled, skipped };
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/core/staleness.test.ts
```

Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/core/staleness.ts tests/core/staleness.test.ts
git commit -m "feat: staleness detection with age, orphan, and reference protection"
```

---

### Task 3: Cluster Detection

Group stale nodes into clusters by traversing link graphs and checking semantic similarity. This is Pass 2 of the compaction pipeline.

**Files:**
- Create: `src/core/clustering.ts`
- Create: `tests/core/clustering.test.ts`

**Step 1: Write the failing test**

`tests/core/clustering.test.ts`:
```typescript
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
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/core/clustering.test.ts
```

Expected: FAIL — module not found

**Step 3: Implement cluster detection**

`src/core/clustering.ts`:
```typescript
import { getDatabase } from '../db/connection.js';
import { searchSimilar } from '../db/vec.js';

export interface Cluster {
  nodeIds: string[];
  namespace: string;
}

interface DetectClustersOptions {
  namespace?: string;
  minClusterSize?: number;
  semanticThreshold?: number;
}

export function detectClusters(options: DetectClustersOptions = {}): Cluster[] {
  const db = getDatabase();
  const minSize = options.minClusterSize ?? 3;
  const semanticThreshold = options.semanticThreshold ?? 0.8;

  // Get all stale nodes in the namespace
  const conditions: string[] = ["status = 'stale'"];
  const params: any[] = [];

  if (options.namespace) {
    conditions.push('namespace = ?');
    params.push(options.namespace);
  }

  const staleNodes = db.prepare(
    `SELECT id, namespace FROM nodes WHERE ${conditions.join(' AND ')}`
  ).all(...params) as { id: string; namespace: string }[];

  if (staleNodes.length === 0) return [];

  const staleIds = new Set(staleNodes.map(n => n.id));

  // Build adjacency from links between stale nodes
  const adjacency = new Map<string, Set<string>>();
  for (const node of staleNodes) {
    adjacency.set(node.id, new Set());
  }

  // Get all links between stale nodes
  const placeholders = staleNodes.map(() => '?').join(',');
  const links = db.prepare(`
    SELECT source_id, target_id FROM links
    WHERE source_id IN (${placeholders}) AND target_id IN (${placeholders})
  `).all(...[...staleIds], ...[...staleIds]) as { source_id: string; target_id: string }[];

  for (const link of links) {
    adjacency.get(link.source_id)?.add(link.target_id);
    adjacency.get(link.target_id)?.add(link.source_id);
  }

  // Add semantic similarity edges
  // For each stale node with an embedding, find similar stale nodes
  for (const node of staleNodes) {
    try {
      const row = db.prepare('SELECT embedding FROM node_embeddings WHERE node_id = ?').get(node.id) as { embedding: Buffer } | undefined;
      if (!row) continue;

      const embedding = new Float32Array(row.embedding.buffer.slice(
        row.embedding.byteOffset,
        row.embedding.byteOffset + row.embedding.byteLength,
      ));

      const similar = searchSimilar(embedding, 10);
      for (const s of similar) {
        if (s.node_id !== node.id && staleIds.has(s.node_id) && s.distance < semanticThreshold) {
          adjacency.get(node.id)?.add(s.node_id);
          adjacency.get(s.node_id)?.add(node.id);
        }
      }
    } catch {
      // Skip nodes without embeddings
    }
  }

  // Find connected components via BFS
  const visited = new Set<string>();
  const clusters: Cluster[] = [];

  for (const node of staleNodes) {
    if (visited.has(node.id)) continue;

    const component: string[] = [];
    const queue: string[] = [node.id];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      component.push(current);

      const neighbors = adjacency.get(current);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            queue.push(neighbor);
          }
        }
      }
    }

    if (component.length >= minSize) {
      clusters.push({
        nodeIds: component,
        namespace: node.namespace,
      });
    }
  }

  return clusters;
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/core/clustering.test.ts
```

Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/core/clustering.ts tests/core/clustering.test.ts
git commit -m "feat: cluster detection via link graph and semantic similarity"
```

---

### Task 4: Claude Summarization Service

Create a service that takes a cluster of nodes and produces a summary via the Claude API.

**Files:**
- Create: `src/core/summarize.ts`
- Create: `tests/core/summarize.test.ts`

**Step 1: Write the failing test**

`tests/core/summarize.test.ts`:
```typescript
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
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/core/summarize.test.ts
```

Expected: FAIL — module not found

**Step 3: Implement summarization service**

`src/core/summarize.ts`:
```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { Node } from './nodes.js';

const MODEL = 'claude-sonnet-4-5-20250929';

export function buildCompactionPrompt(nodes: Node[]): string {
  // Sort chronologically
  const sorted = [...nodes].sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  );

  const nodeDescriptions = sorted.map(n => {
    const title = n.title ? `**${n.title}**` : '(untitled)';
    const tags = n.tags ? ` [tags: ${n.tags.join(', ')}]` : '';
    return `### ${n.id}: ${title}${tags}\nCaptured: ${n.created_at}\n\n${n.content}`;
  }).join('\n\n---\n\n');

  return `You are compacting a cluster of related knowledge nodes into a single summary.

These nodes were captured over time and are now being consolidated. Your job is to produce one concise summary that preserves the essential knowledge.

## Rules

- Preserve all **decisions** and their **rationale** (why something was chosen)
- Preserve **current state** (what is true now, not what was true before)
- When nodes contradict each other, keep the **most recent** information
- Drop **outdated details** that have been superseded
- Keep it **concise** — aim for 2-5 sentences that capture the essence
- Do NOT add commentary or analysis — just distill the knowledge
- Output ONLY the summary text, no headers or metadata

## Nodes to Compact

${nodeDescriptions}

## Summary`;
}

export async function summarizeCluster(nodes: Node[]): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }

  try {
    const client = new Anthropic({ apiKey });
    const prompt = buildCompactionPrompt(nodes);

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = message.content[0];
    if (block.type === 'text') {
      return block.text.trim();
    }

    return null;
  } catch (err) {
    console.error('Summarization failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/core/summarize.test.ts
```

Expected: ALL PASS (only tests prompt building, not API call)

**Step 5: Commit**

```bash
git add src/core/summarize.ts tests/core/summarize.test.ts
git commit -m "feat: Claude-powered summarization for compaction clusters"
```

---

### Task 5: Compaction Orchestrator

Wire together staleness detection, clustering, and summarization into a single pipeline. Creates summary nodes and marks originals as compacted.

**Files:**
- Create: `src/core/compact.ts`
- Create: `tests/core/compact.test.ts`

**Step 1: Write the failing test**

`tests/core/compact.test.ts`:
```typescript
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
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/core/compact.test.ts
```

Expected: FAIL — module not found

**Step 3: Implement compaction orchestrator**

`src/core/compact.ts`:
```typescript
import { getDatabase } from '../db/connection.js';
import { createNode, getNode, updateNodeStatus, type Node } from './nodes.js';
import { detectClusters, type Cluster } from './clustering.js';
import { summarizeCluster } from './summarize.js';
import { generateEmbedding } from './embeddings.js';
import { insertEmbedding } from '../db/vec.js';
import { markEmbeddingDone } from './nodes.js';

export interface CompactionPlan {
  clusters: Cluster[];
  totalNodes: number;
}

export interface CompactionResult {
  summaryNode: Node;
  compactedIds: string[];
}

interface CompactionOptions {
  namespace?: string;
  minClusterSize?: number;
  semanticThreshold?: number;
}

export function dryRunCompaction(options: CompactionOptions = {}): CompactionPlan {
  const clusters = detectClusters({
    namespace: options.namespace,
    minClusterSize: options.minClusterSize ?? 3,
    semanticThreshold: options.semanticThreshold,
  });

  const totalNodes = clusters.reduce((sum, c) => sum + c.nodeIds.length, 0);

  return { clusters, totalNodes };
}

export async function compactCluster(cluster: Cluster): Promise<CompactionResult | null> {
  const db = getDatabase();

  // Load full nodes
  const nodes: Node[] = [];
  for (const id of cluster.nodeIds) {
    const node = getNode(id);
    if (node) nodes.push(node);
  }

  if (nodes.length === 0) return null;

  // Generate summary via Claude
  const summaryContent = await summarizeCluster(nodes);
  if (!summaryContent) return null;

  // Derive title from the cluster
  const titles = nodes.map(n => n.title).filter(Boolean);
  const summaryTitle = titles.length > 0
    ? `Compacted: ${titles.slice(0, 3).join(', ')}${titles.length > 3 ? '...' : ''}`
    : `Compacted ${nodes.length} nodes`;

  // Collect all tags from originals
  const allTags = new Set<string>();
  for (const node of nodes) {
    if (node.tags) node.tags.forEach(t => allTags.add(t));
  }

  // Create summary node
  const summaryNode = createNode({
    namespace: cluster.namespace,
    content: summaryContent,
    title: summaryTitle,
    tags: allTags.size > 0 ? [...allTags] : undefined,
    source_type: 'compaction',
  });

  // Generate embedding for summary
  const embedding = await generateEmbedding(
    summaryTitle + '\n' + summaryContent
  );
  if (embedding) {
    insertEmbedding(summaryNode.id, embedding);
    markEmbeddingDone(summaryNode.id);
  }

  // Re-point inbound links from originals to summary
  const originalIds = cluster.nodeIds;
  const placeholders = originalIds.map(() => '?').join(',');

  // Find links from outside the cluster pointing to nodes inside the cluster
  db.prepare(`
    UPDATE links SET target_id = ?
    WHERE target_id IN (${placeholders})
    AND source_id NOT IN (${placeholders})
  `).run(summaryNode.id, ...originalIds, ...originalIds);

  // Mark originals as compacted
  for (const id of originalIds) {
    updateNodeStatus(id, 'compacted');
    db.prepare('UPDATE nodes SET compacted_into = ? WHERE id = ?').run(summaryNode.id, id);
  }

  // Delete internal links (links between compacted nodes)
  db.prepare(`
    DELETE FROM links
    WHERE source_id IN (${placeholders}) AND target_id IN (${placeholders})
  `).run(...originalIds, ...originalIds);

  return {
    summaryNode,
    compactedIds: originalIds,
  };
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/core/compact.test.ts
```

Expected: ALL PASS

**Step 5: Run all tests**

```bash
npx vitest run
```

Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/core/compact.ts tests/core/compact.test.ts
git commit -m "feat: compaction orchestrator with summary creation and link re-pointing"
```

---

### Task 6: Compact CLI Command

**Files:**
- Create: `src/cli/commands/compact.ts`
- Modify: `src/index.ts`

**Step 1: Create the compact command**

`src/cli/commands/compact.ts`:
```typescript
import { Command } from 'commander';
import { detectStaleNodes } from '../../core/staleness.js';
import { dryRunCompaction, compactCluster } from '../../core/compact.js';
import { getNode } from '../../core/nodes.js';
import { detectFormat, type Format } from '../format.js';

export function compactCommand(): Command {
  return new Command('compact')
    .description('Compact stale knowledge into summaries')
    .option('-n, --namespace <ns>', 'Filter by namespace')
    .option('--dry-run', 'Preview compaction without executing')
    .option('--detect-stale', 'Run staleness detection before compaction')
    .option('--max-age <days>', 'Max age in days for staleness detection', '60')
    .option('--min-cluster <size>', 'Minimum cluster size', '3')
    .option('-f, --format <fmt>', 'Output format')
    .action(async (options) => {
      const format: Format = options.format || detectFormat(Boolean(process.stdout.isTTY));

      // Optionally run staleness detection first
      if (options.detectStale) {
        const staleResult = detectStaleNodes({
          maxAgeDays: parseInt(options.maxAge),
          namespace: options.namespace,
          protectReferenced: true,
        });

        if (format === 'json') {
          console.error(JSON.stringify({ staleness: staleResult }));
        } else {
          if (staleResult.staled.length > 0) {
            console.log(`Staleness detection: marked ${staleResult.staled.length} node(s) as stale (skipped ${staleResult.skipped}).`);
          } else {
            console.log('Staleness detection: no new stale nodes.');
          }
        }
      }

      // Detect clusters
      const plan = dryRunCompaction({
        namespace: options.namespace,
        minClusterSize: parseInt(options.minCluster),
      });

      if (plan.clusters.length === 0) {
        if (format === 'json') {
          console.log(JSON.stringify({ clusters: [], compacted: [] }));
        } else {
          console.log('No clusters found for compaction.');
        }
        return;
      }

      // Dry run — just show what would happen
      if (options.dryRun) {
        if (format === 'json') {
          const output = plan.clusters.map(c => ({
            namespace: c.namespace,
            node_count: c.nodeIds.length,
            node_ids: c.nodeIds,
            nodes: c.nodeIds.map(id => {
              const n = getNode(id);
              return n ? { id: n.id, title: n.title, content: n.content.substring(0, 100) } : null;
            }).filter(Boolean),
          }));
          console.log(JSON.stringify({ clusters: output, total_nodes: plan.totalNodes }, null, 2));
        } else {
          console.log(`Found ${plan.clusters.length} cluster(s) with ${plan.totalNodes} total nodes:\n`);
          for (let i = 0; i < plan.clusters.length; i++) {
            const c = plan.clusters[i];
            console.log(`Cluster ${i + 1}: ${c.nodeIds.length} nodes (${c.namespace})`);
            for (const id of c.nodeIds) {
              const n = getNode(id);
              if (n) {
                console.log(`  [${n.id}] ${n.title || '(untitled)'}`);
                console.log(`    ${n.content.substring(0, 80)}${n.content.length > 80 ? '...' : ''}`);
              }
            }
            console.log('');
          }
        }
        return;
      }

      // Execute compaction
      if (!process.env.ANTHROPIC_API_KEY) {
        console.error('Error: ANTHROPIC_API_KEY environment variable is required for compaction.');
        console.error('Set it with: export ANTHROPIC_API_KEY=your-key-here');
        process.exit(1);
      }

      console.log(`Compacting ${plan.clusters.length} cluster(s) with ${plan.totalNodes} nodes...`);
      const results = [];

      for (let i = 0; i < plan.clusters.length; i++) {
        const cluster = plan.clusters[i];
        console.log(`\nCluster ${i + 1}/${plan.clusters.length} (${cluster.nodeIds.length} nodes)...`);

        const result = await compactCluster(cluster);
        if (result) {
          results.push(result);
          console.log(`  → Created summary: ${result.summaryNode.id} "${result.summaryNode.title}"`);
          console.log(`  → Compacted ${result.compactedIds.length} nodes`);
        } else {
          console.log('  → Failed (summarization error)');
        }
      }

      if (format === 'json') {
        console.log(JSON.stringify({
          compacted: results.map(r => ({
            summary_id: r.summaryNode.id,
            summary_title: r.summaryNode.title,
            compacted_count: r.compactedIds.length,
            compacted_ids: r.compactedIds,
          })),
        }, null, 2));
      } else {
        console.log(`\nDone: ${results.length} cluster(s) compacted.`);
      }
    });
}
```

**Step 2: Register compact command in index.ts**

Add this import to `src/index.ts`:
```typescript
import { compactCommand } from './cli/commands/compact.js';
```

Add this line after the other `addCommand` calls:
```typescript
program.addCommand(compactCommand());
```

**Step 3: Run all tests**

```bash
npx vitest run
```

Expected: ALL PASS

**Step 4: Commit**

```bash
git add src/cli/commands/compact.ts src/index.ts
git commit -m "feat: kt compact command with dry-run, staleness detection, and execution"
```

---

### Task 7: `/compact` Claude Code Skill

**Files:**
- Create: `~/GitHub/kt/commands/compact.md`

**Step 1: Create the skill file**

`~/GitHub/kt/commands/compact.md`:
```markdown
---
name: compact
description: Review and compact stale knowledge in kt
user-invocable: true
---

# Compact Knowledge

Help the user review and compact stale knowledge nodes in their knowledge tracker.

## Process

1. First, run staleness detection and dry-run to see what's available:

```bash
kt compact --detect-stale --dry-run --format json
```

2. Present the results to the user:
   - How many nodes were newly marked stale
   - How many clusters were detected
   - For each cluster: the node titles and a brief preview of contents

3. Ask the user which clusters to compact (all, specific ones, or none).

4. For approved clusters, run the actual compaction:

```bash
kt compact --namespace <ns>
```

5. Report the results:
   - Summary nodes created (ID and title)
   - Number of nodes compacted
   - Any failures

## Guidelines

- Always show dry-run first — never compact without the user seeing what will happen
- If no clusters are found, suggest checking staleness thresholds or waiting for more knowledge to accumulate
- If ANTHROPIC_API_KEY is not set, inform the user they need it for summarization
- After compaction, suggest running `kt stats` to see the updated knowledge base state

## Example

```
User: /compact

Claude: Let me check for compaction candidates...

[runs kt compact --detect-stale --dry-run]

Found 2 clusters ready for compaction:

Cluster 1: "Client X engagement" (4 nodes, namespace: clients)
  - kt-a1b2: "Client X initial meeting"
  - kt-c3d4: "Client X pricing discussion"
  - kt-e5f6: "Client X sprint rejection"
  - kt-g7h8: "Client X quarterly preference"

Cluster 2: "Pricing model evolution" (3 nodes, namespace: ep-advisory)
  - kt-i9j0: "Three-tier pricing"
  - kt-k1l2: "Dropped basic tier"
  - kt-m3n4: "Enterprise tier details"

Compact both, one, or neither?

User: Both

Claude: [runs kt compact]
Done:
- kt-o5p6: "Compacted: Client X initial meeting, Client X pricing discussion..." (4 nodes → 1)
- kt-q7r8: "Compacted: Three-tier pricing, Dropped basic tier..." (3 nodes → 1)

7 nodes compacted into 2 summaries. Run `kt stats` to see updated totals.
```
```

**Step 2: Commit**

```bash
cd ~/GitHub/kt && git add commands/compact.md
git commit -m "feat: /compact Claude Code skill for guided compaction"
```

---

### Task 8: Update Stats Command for Compaction Visibility

Add compaction-specific stats so users can see the impact.

**Files:**
- Modify: `src/cli/commands/stats.ts`

**Step 1: Update stats to include compaction info**

Replace the entire contents of `src/cli/commands/stats.ts`:

```typescript
import { Command } from 'commander';
import { getDatabase } from '../../db/connection.js';
import { detectFormat, type Format } from '../format.js';

interface Stats {
  total: number;
  active: number;
  stale: number;
  compacted: number;
  by_namespace: { namespace: string; count: number }[];
  pending_embeddings: number;
  compaction_summaries: number;
  oldest_active: string | null;
}

export function statsCommand(): Command {
  return new Command('stats')
    .description('Show knowledge base statistics')
    .option('-f, --format <fmt>', 'Output format')
    .action((options) => {
      const db = getDatabase();

      const total = (db.prepare('SELECT COUNT(*) as c FROM nodes').get() as any).c;
      const active = (db.prepare("SELECT COUNT(*) as c FROM nodes WHERE status = 'active'").get() as any).c;
      const stale = (db.prepare("SELECT COUNT(*) as c FROM nodes WHERE status = 'stale'").get() as any).c;
      const compacted = (db.prepare("SELECT COUNT(*) as c FROM nodes WHERE status = 'compacted'").get() as any).c;
      const pending = (db.prepare('SELECT COUNT(*) as c FROM nodes WHERE embedding_pending = 1').get() as any).c;
      const summaries = (db.prepare("SELECT COUNT(*) as c FROM nodes WHERE source_type = 'compaction'").get() as any).c;

      const oldest = db.prepare(
        "SELECT updated_at FROM nodes WHERE status = 'active' ORDER BY updated_at ASC LIMIT 1"
      ).get() as { updated_at: string } | undefined;

      const byNs = db.prepare(
        "SELECT namespace, COUNT(*) as count FROM nodes WHERE status != 'compacted' GROUP BY namespace ORDER BY count DESC"
      ).all() as { namespace: string; count: number }[];

      const stats: Stats = {
        total,
        active,
        stale,
        compacted,
        by_namespace: byNs,
        pending_embeddings: pending,
        compaction_summaries: summaries,
        oldest_active: oldest?.updated_at || null,
      };

      const format: Format = options.format || detectFormat(Boolean(process.stdout.isTTY));

      if (format === 'json') {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log(`Total: ${total}  (active: ${active}, stale: ${stale}, compacted: ${compacted})`);
        console.log(`Compaction summaries: ${summaries}`);
        console.log(`Pending embeddings: ${pending}`);
        if (oldest) {
          console.log(`Oldest active node: ${oldest.updated_at}`);
        }
        if (byNs.length > 0) {
          console.log('\nBy namespace:');
          for (const ns of byNs) {
            console.log(`  ${ns.namespace}: ${ns.count}`);
          }
        }
      }
    });
}
```

**Step 2: Run all tests**

```bash
npx vitest run
```

Expected: ALL PASS

**Step 3: Commit**

```bash
git add src/cli/commands/stats.ts
git commit -m "feat: stats shows compaction summaries and oldest active node"
```

---

### Task 9: Integration Test + Build Verification

**Step 1: Run full test suite**

```bash
cd ~/GitHub/kt && npx vitest run
```

Expected: ALL PASS

**Step 2: Clean build**

```bash
rm -rf dist && npm run build
```

Expected: No errors

**Step 3: Re-link globally**

```bash
npm link
```

**Step 4: Smoke test the compaction pipeline**

```bash
# Create some test data if not already present
kt ns create smoke --name "Smoke Test"
kt capture "Insight one about pricing" --namespace smoke --title "Pricing 1"
kt capture "Insight two about pricing" --namespace smoke --title "Pricing 2"
kt capture "Insight three about pricing" --namespace smoke --title "Pricing 3"

# Link them
NODES=$(kt search "pricing" --namespace smoke --format json | python3 -c "import sys,json; ids=[n['id'] for n in json.load(sys.stdin)]; print(' '.join(ids))")
echo "Nodes: $NODES"

# Manually link them (adjust IDs from output above)
# kt link <id1> related <id2>
# kt link <id2> related <id3>

# Manually stale them for testing
# kt status <id1> stale
# kt status <id2> stale
# kt status <id3> stale

# Dry run
kt compact --namespace smoke --dry-run --min-cluster 2

# Check stats before
kt stats

# If ANTHROPIC_API_KEY is set, run actual compaction:
# kt compact --namespace smoke --min-cluster 2

# Check stats after
# kt stats
```

**Step 5: Commit any fixes**

```bash
cd ~/GitHub/kt && git add -A
git commit -m "fix: adjustments from Phase 4 smoke testing"
```

**Step 6: Tag**

```bash
git tag v0.4.0
```

Phase 4 complete.

---

## What You Have After All 4 Phases

| Phase | Capability |
|-------|-----------|
| 1 | CLI with CRUD, links, namespaces, keyword search |
| 2 | Semantic search, smart capture, auto-linking, embedding queue |
| 3 | Auto-loaded context at session start, `/capture` skill, ambient lookups |
| 4 | Staleness detection, cluster grouping, Claude-powered compaction, `/compact` skill |

The full lifecycle: **capture → search → context load → stale → cluster → compact → repeat**.
