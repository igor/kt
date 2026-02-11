# Knowledge Tracker (kt) — Phase 2: Capture Intelligence

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Ollama-powered embeddings and semantic search so `kt` can find knowledge by meaning, detect duplicates on capture, and auto-link related nodes.

**Architecture:** Ollama client calls `nomic-embed-text` to generate 768-dim embeddings stored via sqlite-vec virtual table. Search upgrades from keyword LIKE to cosine similarity with keyword fallback when Ollama is unavailable. Capture flow gains duplicate detection and auto-linking. All embedding operations are async (Ollama HTTP call) but the rest of the system stays synchronous.

**Tech Stack:** ollama (npm package), sqlite-vec (already installed), vitest

**Reference:** Design doc at `docs/plans/2026-02-10-knowledge-tracker-design.md`, Phase 1 code in `src/`

**Important context for implementer:**
- The project uses ESM (`"type": "module"` in package.json)
- Database is better-sqlite3 (synchronous API)
- sqlite-vec is already in package.json but not yet loaded or used
- The `nodes` table already has `embedding BLOB` and `embedding_pending INTEGER` columns
- Test pattern: temp database per test in `os.tmpdir()`, cleanup in `afterEach`
- All `.js` imports in TypeScript (ESM resolution)
- Build script: `tsc && mkdir -p dist/db && cp src/db/schema.sql dist/db/`

---

### Task 1: Install Ollama Dependency

**Files:**
- Modify: `package.json`

**Step 1: Install the ollama npm package**

```bash
cd ~/GitHub/kt && npm install ollama
```

**Step 2: Verify it installed**

```bash
node -e "import('ollama').then(m => console.log('ok'))"
```

Expected: `ok`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add ollama dependency"
```

---

### Task 2: Embedding Service

**Files:**
- Create: `src/core/embeddings.ts`
- Create: `tests/core/embeddings.test.ts`

**Step 1: Write the failing test**

`tests/core/embeddings.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { generateEmbedding, isOllamaAvailable } from '../../src/core/embeddings.js';

describe('embeddings', () => {
  describe('isOllamaAvailable', () => {
    it('returns false when Ollama is not running', async () => {
      // Use a port that's almost certainly not running Ollama
      const result = await isOllamaAvailable('http://127.0.0.1:99999');
      expect(result).toBe(false);
    });
  });

  describe('generateEmbedding', () => {
    it('returns null when Ollama is unavailable', async () => {
      const result = await generateEmbedding('test text', 'http://127.0.0.1:99999');
      expect(result).toBeNull();
    });

    // This test only runs if Ollama is actually running locally
    // Skip in CI, run manually to verify integration
    it.skipIf(!process.env.TEST_OLLAMA)('generates a 768-dim embedding when Ollama is running', async () => {
      const result = await generateEmbedding('test text');
      expect(result).not.toBeNull();
      expect(result!.length).toBe(768);
      expect(result).toBeInstanceOf(Float32Array);
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/core/embeddings.test.ts
```

Expected: FAIL — module not found

**Step 3: Implement embedding service**

`src/core/embeddings.ts`:
```typescript
import { Ollama } from 'ollama';

const DEFAULT_HOST = 'http://127.0.0.1:11434';
const MODEL = 'nomic-embed-text';

export async function isOllamaAvailable(host?: string): Promise<boolean> {
  try {
    const response = await fetch(`${host || DEFAULT_HOST}/api/tags`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function generateEmbedding(
  text: string,
  host?: string,
): Promise<Float32Array | null> {
  const ollamaHost = host || DEFAULT_HOST;

  if (!(await isOllamaAvailable(ollamaHost))) {
    return null;
  }

  try {
    const ollama = new Ollama({ host: ollamaHost });
    const response = await ollama.embed({
      model: MODEL,
      input: text,
    });

    const raw = response.embeddings[0];
    return new Float32Array(raw);
  } catch {
    return null;
  }
}

export function serializeEmbedding(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer);
}

export function deserializeEmbedding(buffer: Buffer): Float32Array {
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
  return new Float32Array(arrayBuffer);
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/core/embeddings.test.ts
```

Expected: 2 PASS, 1 SKIPPED (the Ollama integration test)

**Step 5: Commit**

```bash
git add src/core/embeddings.ts tests/core/embeddings.test.ts
git commit -m "feat: embedding service with Ollama client and graceful fallback"
```

---

### Task 3: sqlite-vec Integration

**Files:**
- Modify: `src/db/connection.ts`
- Modify: `src/db/schema.sql`
- Create: `tests/db/vec.test.ts`

**Step 1: Write the failing test for vector search**

`tests/db/vec.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, closeDatabase, getDatabase } from '../../src/db/connection.js';
import { insertEmbedding, searchSimilar } from '../../src/db/vec.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('sqlite-vec integration', () => {
  const testDir = path.join(os.tmpdir(), 'kt-test-vec-' + Date.now());
  const testDb = path.join(testDir, 'kt.db');

  beforeEach(() => {
    createDatabase(testDb);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('inserts and retrieves a vector', () => {
    // Create a fake 768-dim embedding
    const embedding = new Float32Array(768);
    embedding[0] = 1.0;
    embedding[1] = 0.5;

    insertEmbedding('kt-test1', embedding);

    // Verify it was stored
    const db = getDatabase();
    const row = db.prepare('SELECT COUNT(*) as c FROM node_embeddings').get() as { c: number };
    expect(row.c).toBe(1);
  });

  it('finds similar vectors by cosine distance', () => {
    // Insert three embeddings with known similarity patterns
    const embA = new Float32Array(768).fill(0);
    embA[0] = 1.0; embA[1] = 0.0;

    const embB = new Float32Array(768).fill(0);
    embB[0] = 0.9; embB[1] = 0.1;

    const embC = new Float32Array(768).fill(0);
    embC[0] = 0.0; embC[1] = 1.0;

    insertEmbedding('kt-close', embA);
    insertEmbedding('kt-similar', embB);
    insertEmbedding('kt-different', embC);

    // Search for vectors similar to embA
    const query = new Float32Array(768).fill(0);
    query[0] = 1.0; query[1] = 0.0;

    const results = searchSimilar(query, 3);
    expect(results.length).toBeGreaterThanOrEqual(2);
    // The closest should be kt-close (exact match)
    expect(results[0].node_id).toBe('kt-close');
  });

  it('respects limit parameter', () => {
    for (let i = 0; i < 10; i++) {
      const emb = new Float32Array(768).fill(0);
      emb[0] = Math.random();
      insertEmbedding(`kt-n${i}`, emb);
    }

    const query = new Float32Array(768).fill(0);
    query[0] = 0.5;

    const results = searchSimilar(query, 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/db/vec.test.ts
```

Expected: FAIL — modules not found

**Step 3: Load sqlite-vec extension in connection.ts**

Modify `src/db/connection.ts`. Add sqlite-vec loading after database creation. The key change is adding the `loadVecExtension()` call and the vec0 virtual table creation.

Read the current file first, then apply this change — add the import and load call:

At the top of `src/db/connection.ts`, add the import:
```typescript
import * as sqliteVec from 'sqlite-vec';
```

Inside `createDatabase()`, after `db.pragma('foreign_keys = ON');` and before the schema loading, add:
```typescript
  // Load sqlite-vec extension for vector search
  sqliteVec.load(db);
```

**Step 4: Add vec0 virtual table to schema.sql**

Append to the end of `src/db/schema.sql`:
```sql

CREATE VIRTUAL TABLE IF NOT EXISTS node_embeddings USING vec0(
  node_id TEXT PRIMARY KEY,
  embedding FLOAT[768]
);
```

**Step 5: Create the vec helper module**

`src/db/vec.ts`:
```typescript
import { getDatabase } from './connection.js';

export interface SimilarResult {
  node_id: string;
  distance: number;
}

export function insertEmbedding(nodeId: string, embedding: Float32Array): void {
  const db = getDatabase();
  const buf = Buffer.from(embedding.buffer);
  db.prepare('INSERT OR REPLACE INTO node_embeddings (node_id, embedding) VALUES (?, ?)').run(
    nodeId,
    buf,
  );
}

export function deleteEmbedding(nodeId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM node_embeddings WHERE node_id = ?').run(nodeId);
}

export function searchSimilar(
  queryEmbedding: Float32Array,
  limit: number = 5,
): SimilarResult[] {
  const db = getDatabase();
  const buf = Buffer.from(queryEmbedding.buffer);

  const rows = db.prepare(`
    SELECT node_id, distance
    FROM node_embeddings
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT ?
  `).all(buf, limit);

  return rows as SimilarResult[];
}
```

**Step 6: Run test to verify it passes**

```bash
npx vitest run tests/db/vec.test.ts
```

Expected: ALL PASS

**Step 7: Run all existing tests to check nothing broke**

```bash
npx vitest run
```

Expected: ALL PASS (sqlite-vec loading should be transparent to existing tests)

**Step 8: Commit**

```bash
git add src/db/connection.ts src/db/schema.sql src/db/vec.ts tests/db/vec.test.ts
git commit -m "feat: sqlite-vec integration for vector storage and similarity search"
```

---

### Task 4: Semantic Search

**Files:**
- Modify: `src/core/search.ts`
- Modify: `tests/core/search.test.ts`

**Step 1: Write failing test for semantic search**

Add new tests to `tests/core/search.test.ts`. The test needs to insert nodes with pre-computed fake embeddings, then search semantically.

Append these test cases to the existing `describe` block in `tests/core/search.test.ts`:

```typescript
import { insertEmbedding } from '../../src/db/vec.js';
import { semanticSearch } from '../../src/core/search.js';

describe('semantic search', () => {
  const testDir = path.join(os.tmpdir(), 'kt-test-semantic-' + Date.now());
  const testDb = path.join(testDir, 'kt.db');

  beforeEach(() => {
    createDatabase(testDb);

    // Create nodes with fake embeddings that have known similarity
    const nodeA = createNode({ namespace: 'test', content: 'Quarterly planning preference', title: 'Planning' });
    const nodeB = createNode({ namespace: 'test', content: 'Sprint format rejected', title: 'Sprints' });
    const nodeC = createNode({ namespace: 'test', content: 'Pricing model discussion', title: 'Pricing' });

    // Embedding A and B are similar (both about planning), C is different
    const embA = new Float32Array(768).fill(0);
    embA[0] = 0.9; embA[1] = 0.8; embA[2] = 0.1;

    const embB = new Float32Array(768).fill(0);
    embB[0] = 0.85; embB[1] = 0.75; embB[2] = 0.15;

    const embC = new Float32Array(768).fill(0);
    embC[0] = 0.1; embC[1] = 0.1; embC[2] = 0.9;

    insertEmbedding(nodeA.id, embA);
    insertEmbedding(nodeB.id, embB);
    insertEmbedding(nodeC.id, embC);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('finds nodes by embedding similarity', () => {
    // Query similar to A and B (planning-related)
    const queryEmb = new Float32Array(768).fill(0);
    queryEmb[0] = 0.88; queryEmb[1] = 0.78; queryEmb[2] = 0.12;

    const results = semanticSearch(queryEmb, { limit: 2 });
    expect(results.length).toBe(2);
    // Both planning-related nodes should come before pricing
    const titles = results.map(r => r.title);
    expect(titles).not.toContain('Pricing');
  });

  it('filters by namespace', () => {
    // Add a node in a different namespace
    const other = createNode({ namespace: 'other', content: 'Other content' });
    const embOther = new Float32Array(768).fill(0);
    embOther[0] = 0.9; embOther[1] = 0.8;
    insertEmbedding(other.id, embOther);

    const queryEmb = new Float32Array(768).fill(0);
    queryEmb[0] = 0.9; queryEmb[1] = 0.8;

    const results = semanticSearch(queryEmb, { namespace: 'test', limit: 10 });
    const namespaces = results.map(r => r.namespace);
    expect(namespaces.every(n => n === 'test')).toBe(true);
  });

  it('excludes compacted nodes', () => {
    // Mark a node as compacted
    const nodes = listNodes({ namespace: 'test' });
    updateNodeStatus(nodes[0].id, 'compacted');

    const queryEmb = new Float32Array(768).fill(0);
    queryEmb[0] = 0.9; queryEmb[1] = 0.8;

    const results = semanticSearch(queryEmb, { limit: 10 });
    const ids = results.map(r => r.id);
    expect(ids).not.toContain(nodes[0].id);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/core/search.test.ts
```

Expected: FAIL — `semanticSearch` not exported

**Step 3: Add semantic search to search.ts**

Add these imports to the top of `src/core/search.ts`:
```typescript
import { searchSimilar } from '../db/vec.js';
```

Add this function after the existing `searchNodes` function:

```typescript
interface SemanticSearchOptions {
  namespace?: string;
  limit?: number;
  excludeIds?: string[];
}

export function semanticSearch(
  queryEmbedding: Float32Array,
  options: SemanticSearchOptions = {},
): Node[] {
  const limit = options.limit || 10;

  // Get candidates from vec search (fetch more than needed to allow filtering)
  const candidates = searchSimilar(queryEmbedding, limit * 3);

  if (candidates.length === 0) return [];

  const db = getDatabase();
  const nodeIds = candidates.map(c => c.node_id);
  const placeholders = nodeIds.map(() => '?').join(',');

  const conditions: string[] = [
    `id IN (${placeholders})`,
    "status != 'compacted'",
  ];
  const params: any[] = [...nodeIds];

  if (options.namespace) {
    conditions.push('namespace = ?');
    params.push(options.namespace);
  }

  if (options.excludeIds && options.excludeIds.length > 0) {
    const exPlaceholders = options.excludeIds.map(() => '?').join(',');
    conditions.push(`id NOT IN (${exPlaceholders})`);
    params.push(...options.excludeIds);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const rows = db.prepare(`SELECT * FROM nodes ${where}`).all(...params);

  // Preserve the similarity ordering from vec search
  const nodeMap = new Map(rows.map(r => [(r as any).id, r]));
  const ordered = nodeIds
    .filter(id => nodeMap.has(id))
    .map(id => rowToNode(nodeMap.get(id)))
    .slice(0, limit);

  return ordered;
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/core/search.test.ts
```

Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/core/search.ts tests/core/search.test.ts
git commit -m "feat: semantic search via sqlite-vec with namespace filtering"
```

---

### Task 5: Embed Command + Pending Queue

**Files:**
- Create: `src/cli/commands/embed.ts`
- Modify: `src/core/nodes.ts`
- Modify: `src/index.ts`
- Create: `tests/core/embed-queue.test.ts`

**Step 1: Write failing test for embed queue processing**

`tests/core/embed-queue.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, closeDatabase, getDatabase } from '../../src/db/connection.js';
import { createNode } from '../../src/core/nodes.js';
import { getPendingEmbeddings, markEmbeddingDone } from '../../src/core/nodes.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('embedding queue', () => {
  const testDir = path.join(os.tmpdir(), 'kt-test-embed-' + Date.now());
  const testDb = path.join(testDir, 'kt.db');

  beforeEach(() => createDatabase(testDb));
  afterEach(() => { closeDatabase(); fs.rmSync(testDir, { recursive: true, force: true }); });

  it('new nodes start with embedding_pending = true', () => {
    const node = createNode({ namespace: 'test', content: 'needs embedding' });
    expect(node.embedding_pending).toBe(true);
  });

  it('getPendingEmbeddings returns nodes awaiting embeddings', () => {
    createNode({ namespace: 'test', content: 'pending 1' });
    createNode({ namespace: 'test', content: 'pending 2' });

    const pending = getPendingEmbeddings();
    expect(pending).toHaveLength(2);
  });

  it('markEmbeddingDone clears the pending flag', () => {
    const node = createNode({ namespace: 'test', content: 'will be embedded' });
    markEmbeddingDone(node.id);

    const pending = getPendingEmbeddings();
    expect(pending).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/core/embed-queue.test.ts
```

Expected: FAIL — `getPendingEmbeddings` and `markEmbeddingDone` not found

**Step 3: Add queue functions to nodes.ts**

Add these functions at the end of `src/core/nodes.ts`:

```typescript
export function getPendingEmbeddings(limit: number = 50): Node[] {
  const db = getDatabase();
  const rows = db.prepare(
    'SELECT * FROM nodes WHERE embedding_pending = 1 ORDER BY created_at ASC LIMIT ?'
  ).all(limit);
  return rows.map(rowToNode);
}

export function markEmbeddingDone(id: string): void {
  const db = getDatabase();
  db.prepare(
    "UPDATE nodes SET embedding_pending = 0, updated_at = datetime('now') WHERE id = ?"
  ).run(id);
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/core/embed-queue.test.ts
```

Expected: ALL PASS

**Step 5: Create the embed CLI command**

`src/cli/commands/embed.ts`:
```typescript
import { Command } from 'commander';
import { getPendingEmbeddings, markEmbeddingDone } from '../../core/nodes.js';
import { generateEmbedding } from '../../core/embeddings.js';
import { insertEmbedding } from '../../db/vec.js';

export function embedCommand(): Command {
  return new Command('embed')
    .description('Generate embeddings for pending nodes')
    .option('-l, --limit <number>', 'Max nodes to process', '50')
    .action(async (options) => {
      const pending = getPendingEmbeddings(parseInt(options.limit));

      if (pending.length === 0) {
        console.log('No pending embeddings.');
        return;
      }

      console.log(`Processing ${pending.length} pending embeddings...`);
      let success = 0;
      let failed = 0;

      for (const node of pending) {
        const text = node.title ? `${node.title}\n${node.content}` : node.content;
        const embedding = await generateEmbedding(text);

        if (embedding) {
          insertEmbedding(node.id, embedding);
          markEmbeddingDone(node.id);
          success++;
          console.log(`  ${node.id} ✓`);
        } else {
          failed++;
          console.log(`  ${node.id} ✗ (Ollama unavailable)`);
          // Stop trying if Ollama is down — no point hitting every node
          if (failed === 1) {
            console.log('Ollama appears unavailable. Stopping.');
            break;
          }
        }
      }

      console.log(`Done: ${success} embedded, ${failed} failed, ${pending.length - success - failed} skipped.`);
    });
}
```

**Step 6: Register embed command in index.ts**

Add this import to `src/index.ts`:
```typescript
import { embedCommand } from './cli/commands/embed.js';
```

Add this line after the other `addCommand` calls:
```typescript
program.addCommand(embedCommand());
```

**Step 7: Run all tests**

```bash
npx vitest run
```

Expected: ALL PASS

**Step 8: Commit**

```bash
git add src/core/nodes.ts src/cli/commands/embed.ts src/index.ts tests/core/embed-queue.test.ts
git commit -m "feat: embedding queue with kt embed command"
```

---

### Task 6: Smart Capture (Duplicate Detection + Auto-linking)

**Files:**
- Create: `src/core/capture.ts`
- Modify: `src/cli/commands/capture.ts`
- Create: `tests/core/capture.test.ts`

**Step 1: Write failing test for smart capture**

`tests/core/capture.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, closeDatabase } from '../../src/db/connection.js';
import { createNode } from '../../src/core/nodes.js';
import { getLinks } from '../../src/core/links.js';
import { insertEmbedding } from '../../src/db/vec.js';
import { findSimilarNodes, captureWithIntelligence } from '../../src/core/capture.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('smart capture', () => {
  const testDir = path.join(os.tmpdir(), 'kt-test-capture-' + Date.now());
  const testDb = path.join(testDir, 'kt.db');

  beforeEach(() => {
    createDatabase(testDb);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('findSimilarNodes', () => {
    it('finds similar nodes by embedding', () => {
      const existing = createNode({ namespace: 'test', content: 'Client X prefers quarterly planning' });

      const embExisting = new Float32Array(768).fill(0);
      embExisting[0] = 0.9; embExisting[1] = 0.8;
      insertEmbedding(existing.id, embExisting);

      const queryEmb = new Float32Array(768).fill(0);
      queryEmb[0] = 0.88; queryEmb[1] = 0.78;

      const similar = findSimilarNodes(queryEmb, { namespace: 'test', limit: 5 });
      expect(similar.length).toBeGreaterThan(0);
      expect(similar[0].id).toBe(existing.id);
    });

    it('falls back to keyword search when no embeddings exist', () => {
      createNode({ namespace: 'test', content: 'quarterly planning cycles' });

      const similar = findSimilarNodes(null, { namespace: 'test', keyword: 'quarterly' });
      expect(similar.length).toBeGreaterThan(0);
    });
  });

  describe('captureWithIntelligence', () => {
    it('creates a node and returns similar nodes', () => {
      // Pre-existing node with embedding
      const existing = createNode({ namespace: 'test', content: 'Sprint planning discussion' });
      const emb = new Float32Array(768).fill(0);
      emb[0] = 0.9; emb[1] = 0.8;
      insertEmbedding(existing.id, emb);

      const result = captureWithIntelligence({
        namespace: 'test',
        content: 'Client rejected sprint format',
        // No embedding available (Ollama down) — keyword fallback
        embedding: null,
      });

      expect(result.node.id).toMatch(/^kt-/);
      expect(result.node.content).toBe('Client rejected sprint format');
      // Similar nodes found via keyword ("sprint")
      expect(result.similar).toBeDefined();
    });

    it('auto-links to similar nodes when embedding is provided', () => {
      const existing = createNode({ namespace: 'test', content: 'Existing knowledge' });
      const embExisting = new Float32Array(768).fill(0);
      embExisting[0] = 0.9; embExisting[1] = 0.8;
      insertEmbedding(existing.id, embExisting);

      const newEmb = new Float32Array(768).fill(0);
      newEmb[0] = 0.88; newEmb[1] = 0.78;

      const result = captureWithIntelligence({
        namespace: 'test',
        content: 'Related knowledge',
        embedding: newEmb,
        autoLink: true,
      });

      // Should have auto-linked to the existing similar node
      const links = getLinks(result.node.id);
      expect(links.length).toBeGreaterThan(0);
      expect(links[0].link_type).toBe('related');
      expect(links[0].target_id).toBe(existing.id);
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/core/capture.test.ts
```

Expected: FAIL — module not found

**Step 3: Implement smart capture**

`src/core/capture.ts`:
```typescript
import { createNode, markEmbeddingDone, type Node } from './nodes.js';
import { searchNodes, semanticSearch } from './search.js';
import { createLink } from './links.js';
import { insertEmbedding } from '../db/vec.js';

interface FindSimilarOptions {
  namespace?: string;
  keyword?: string;
  limit?: number;
  excludeIds?: string[];
}

interface CaptureInput {
  namespace: string;
  content: string;
  title?: string;
  tags?: string[];
  embedding: Float32Array | null;
  autoLink?: boolean;
  similarityThreshold?: number;
}

interface CaptureResult {
  node: Node;
  similar: Node[];
  autoLinked: string[];
}

const DEFAULT_AUTO_LINK_LIMIT = 3;
const DEFAULT_SIMILARITY_RESULTS = 5;

export function findSimilarNodes(
  embedding: Float32Array | null,
  options: FindSimilarOptions = {},
): Node[] {
  const limit = options.limit || DEFAULT_SIMILARITY_RESULTS;

  // Try semantic search first
  if (embedding) {
    const results = semanticSearch(embedding, {
      namespace: options.namespace,
      limit,
      excludeIds: options.excludeIds,
    });
    if (results.length > 0) return results;
  }

  // Fall back to keyword search
  if (options.keyword) {
    return searchNodes(options.keyword, {
      namespace: options.namespace,
      limit,
    });
  }

  return [];
}

export function captureWithIntelligence(input: CaptureInput): CaptureResult {
  // Create the node
  const node = createNode({
    namespace: input.namespace,
    content: input.content,
    title: input.title,
    tags: input.tags,
  });

  // Store embedding if available
  if (input.embedding) {
    insertEmbedding(node.id, input.embedding);
    markEmbeddingDone(node.id);
  }

  // Find similar nodes
  const keyword = input.content.split(/\s+/).slice(0, 5).join(' ');
  const similar = findSimilarNodes(input.embedding, {
    namespace: input.namespace,
    keyword,
    excludeIds: [node.id],
  });

  // Auto-link to similar nodes
  const autoLinked: string[] = [];
  if (input.autoLink && similar.length > 0) {
    const linkLimit = Math.min(similar.length, DEFAULT_AUTO_LINK_LIMIT);
    for (let i = 0; i < linkLimit; i++) {
      createLink(node.id, 'related', similar[i].id);
      autoLinked.push(similar[i].id);
    }
  }

  return { node, similar, autoLinked };
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/core/capture.test.ts
```

Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/core/capture.ts tests/core/capture.test.ts
git commit -m "feat: smart capture with duplicate detection and auto-linking"
```

---

### Task 7: Upgrade Capture CLI Command

**Files:**
- Modify: `src/cli/commands/capture.ts`

**Step 1: Update capture command to use smart capture**

Replace the entire contents of `src/cli/commands/capture.ts`:

```typescript
import { Command } from 'commander';
import { captureWithIntelligence } from '../../core/capture.js';
import { generateEmbedding } from '../../core/embeddings.js';
import { ensureNamespace } from '../../core/namespaces.js';
import { resolveNamespace } from '../../core/mappings.js';
import { formatNodeBrief } from '../format.js';

export function captureCommand(): Command {
  return new Command('capture')
    .description('Capture knowledge')
    .argument('<content>', 'The knowledge to capture')
    .option('-n, --namespace <ns>', 'Namespace')
    .option('-t, --title <title>', 'Title for the node')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--no-link', 'Skip auto-linking')
    .action(async (content, options) => {
      const namespace = options.namespace || resolveNamespace(process.cwd()) || 'default';
      ensureNamespace(namespace);

      const tags = options.tags ? options.tags.split(',').map((t: string) => t.trim()) : undefined;

      // Try to generate embedding (graceful if Ollama is down)
      const text = options.title ? `${options.title}\n${content}` : content;
      const embedding = await generateEmbedding(text);

      const result = captureWithIntelligence({
        namespace,
        content,
        title: options.title,
        tags,
        embedding,
        autoLink: options.link !== false,
      });

      // Output the node ID (primary output for agents)
      console.log(result.node.id);

      // If similar nodes found, mention them (stderr so it doesn't break piping)
      if (result.similar.length > 0) {
        console.error(`\nSimilar existing knowledge:`);
        for (const s of result.similar.slice(0, 3)) {
          console.error(`  ${formatNodeBrief(s)}`);
        }
      }

      if (result.autoLinked.length > 0) {
        console.error(`Auto-linked to ${result.autoLinked.length} related node(s).`);
      }

      if (!embedding) {
        console.error('(Embedding pending — run `kt embed` when Ollama is available)');
      }
    });
}
```

**Step 2: Run CLI integration tests**

```bash
npx vitest run tests/cli/commands.test.ts
```

Expected: ALL PASS (capture still returns an ID on first line)

**Step 3: Run all tests**

```bash
npx vitest run
```

Expected: ALL PASS

**Step 4: Commit**

```bash
git add src/cli/commands/capture.ts
git commit -m "feat: upgrade capture command with smart capture, embedding, and auto-linking"
```

---

### Task 8: Upgrade Search CLI to Support Semantic Mode

**Files:**
- Modify: `src/cli/commands/search.ts`

**Step 1: Update search command to try semantic search first**

Replace the entire contents of `src/cli/commands/search.ts`:

```typescript
import { Command } from 'commander';
import { searchNodes, semanticSearch } from '../../core/search.js';
import { generateEmbedding } from '../../core/embeddings.js';
import { formatNodeList, detectFormat, type Format } from '../format.js';

export function searchCommand(): Command {
  return new Command('search')
    .description('Search knowledge nodes')
    .argument('<query>', 'Search query')
    .option('-n, --namespace <ns>', 'Filter by namespace')
    .option('-k, --limit <number>', 'Max results', '10')
    .option('-f, --format <fmt>', 'Output format (json|human|brief)')
    .option('--keyword', 'Force keyword search (skip semantic)')
    .action(async (query, options) => {
      const limit = parseInt(options.limit);
      const format: Format = options.format || detectFormat(Boolean(process.stdout.isTTY));

      let results;

      if (!options.keyword) {
        // Try semantic search first
        const embedding = await generateEmbedding(query);
        if (embedding) {
          results = semanticSearch(embedding, {
            namespace: options.namespace,
            limit,
          });
        }
      }

      // Fall back to keyword search
      if (!results || results.length === 0) {
        results = searchNodes(query, {
          namespace: options.namespace,
          limit,
        });
      }

      console.log(formatNodeList(results, format));
    });
}
```

**Step 2: Run CLI integration tests**

```bash
npx vitest run tests/cli/commands.test.ts
```

Expected: ALL PASS (keyword search still works as fallback when Ollama is down in test env)

**Step 3: Commit**

```bash
git add src/cli/commands/search.ts
git commit -m "feat: search tries semantic first, falls back to keyword"
```

---

### Task 9: Handle Async Commands in CLI Entry Point

**Files:**
- Modify: `src/index.ts`

The capture, search, and embed commands are now async (they call Ollama). Commander.js handles async actions, but we need to make sure unhandled rejections are caught.

**Step 1: Add error handling to index.ts**

Add this at the end of `src/index.ts`, replacing the bare `program.parse()`:

```typescript
program.parseAsync().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
```

**Step 2: Verify the CLI still works**

```bash
npx tsx src/index.ts --help
npx tsx src/index.ts capture "test node" --namespace test
npx tsx src/index.ts search "test"
```

Expected: All work without errors

**Step 3: Run all tests**

```bash
npx vitest run
```

Expected: ALL PASS

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "fix: handle async commands with parseAsync and error catching"
```

---

### Task 10: Build Verification + Tag

**Step 1: Clean build**

```bash
cd ~/GitHub/kt && rm -rf dist && npm run build
```

Expected: No errors, `dist/` populated

**Step 2: Run full test suite**

```bash
npx vitest run
```

Expected: ALL PASS

**Step 3: Manual smoke test with Ollama running**

If Ollama is running locally with `nomic-embed-text`:

```bash
# Capture with embedding
kt capture "Semantic search now works in kt" --namespace test --title "Phase 2 complete"

# Should show no pending
kt stats

# Semantic search
kt search "does semantic search work"

# Embed any remaining
kt embed
```

If Ollama is NOT running:

```bash
# Capture still works (embedding queued)
kt capture "Graceful degradation test" --namespace test

# Should show 1 pending embedding
kt stats

# Search falls back to keyword
kt search "degradation"
```

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: adjustments from Phase 2 smoke testing"
```

**Step 5: Tag**

```bash
git tag v0.2.0
```

Phase 2 complete.
