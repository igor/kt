# Knowledge Tracker (kt) — Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a working CLI knowledge store with CRUD, links, namespaces, and keyword search — the foundation for all later phases.

**Architecture:** TypeScript CLI using Commander.js for commands, better-sqlite3 + sqlite-vec for storage, SHA256-based hash IDs. All data in `~/.kt/kt.db`. Synchronous database layer (better-sqlite3 is sync), async only where Ollama is called (Phase 2).

**Tech Stack:** TypeScript, better-sqlite3, sqlite-vec, Commander.js, Node.js crypto, vitest (testing)

**Reference:** Design doc at `docs/plans/2026-02-10-knowledge-tracker-design.md`

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts` (entry point, empty)
- Create: `src/db/schema.sql` (reference schema)
- Create: `.gitignore`

**Step 1: Initialize project**

```bash
mkdir -p ~/GitHub/kt && cd ~/GitHub/kt
git init
```

**Step 2: Create package.json**

```json
{
  "name": "kt",
  "version": "0.1.0",
  "description": "CLI-first knowledge tracker for AI agents",
  "type": "module",
  "bin": {
    "kt": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "engines": {
    "node": ">=20"
  }
}
```

**Step 3: Install dependencies**

```bash
npm install better-sqlite3 sqlite-vec commander
npm install -D typescript @types/better-sqlite3 @types/node tsx vitest
```

**Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 5: Create .gitignore**

```
node_modules/
dist/
*.db
*.db-wal
*.db-shm
```

**Step 6: Create directory structure**

```bash
mkdir -p src/{db,core,cli}
mkdir -p tests/{db,core,cli}
```

**Step 7: Create placeholder entry point**

`src/index.ts`:
```typescript
#!/usr/bin/env node
console.log('kt');
```

**Step 8: Verify build works**

```bash
npx tsc
node dist/index.js
```

Expected: prints `kt`

**Step 9: Commit**

```bash
git add -A
git commit -m "chore: project scaffolding"
```

---

### Task 2: Database Layer

**Files:**
- Create: `src/db/connection.ts`
- Create: `src/db/schema.sql`
- Create: `src/db/migrate.ts`
- Create: `tests/db/connection.test.ts`

**Step 1: Write the failing test for database initialization**

`tests/db/connection.test.ts`:
```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { createDatabase, closeDatabase } from '../../src/db/connection.js';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('database connection', () => {
  const testDir = path.join(os.tmpdir(), 'kt-test-' + Date.now());
  const testDb = path.join(testDir, 'kt.db');

  afterEach(() => {
    closeDatabase();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('creates database file and runs migrations', () => {
    const db = createDatabase(testDb);
    expect(fs.existsSync(testDb)).toBe(true);

    // Verify tables exist
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const tableNames = tables.map(t => t.name);

    expect(tableNames).toContain('nodes');
    expect(tableNames).toContain('links');
    expect(tableNames).toContain('namespaces');
    expect(tableNames).toContain('project_mappings');
  });

  it('enables WAL mode', () => {
    const db = createDatabase(testDb);
    const result = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(result.journal_mode).toBe('wal');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/db/connection.test.ts
```

Expected: FAIL — module not found

**Step 3: Create the schema file**

`src/db/schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS nodes (
  id                TEXT PRIMARY KEY,
  namespace         TEXT NOT NULL,
  title             TEXT,
  content           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'stale', 'compacted')),
  source_type       TEXT NOT NULL DEFAULT 'capture' CHECK(source_type IN ('capture', 'compaction')),
  tags              TEXT,
  embedding         BLOB,
  embedding_pending INTEGER NOT NULL DEFAULT 0,
  compacted_into    TEXT REFERENCES nodes(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  stale_at          TEXT,
  session_id        TEXT
);

CREATE INDEX IF NOT EXISTS idx_nodes_namespace ON nodes(namespace);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_nodes_updated ON nodes(updated_at);

CREATE TABLE IF NOT EXISTS links (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL REFERENCES nodes(id),
  target_id   TEXT NOT NULL REFERENCES nodes(id),
  link_type   TEXT NOT NULL CHECK(link_type IN ('supersedes', 'contradicts', 'related')),
  context     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id);
CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id);

CREATE TABLE IF NOT EXISTS namespaces (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS project_mappings (
  directory_pattern TEXT PRIMARY KEY,
  namespace         TEXT NOT NULL REFERENCES namespaces(slug)
);
```

**Step 4: Implement connection module**

`src/db/connection.ts`:
```typescript
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let db: Database.Database | null = null;

export function createDatabase(dbPath: string): Database.Database {
  // Ensure directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run schema
  const schemaPath = new URL('schema.sql', import.meta.url).pathname;
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  return db;
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call createDatabase() first.');
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function getDefaultDbPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '~';
  return path.join(home, '.kt', 'kt.db');
}
```

**Step 5: Run test to verify it passes**

```bash
npx vitest run tests/db/connection.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/db/ tests/db/
git commit -m "feat: database layer with schema and connection"
```

---

### Task 3: Node CRUD + ID Generation

**Files:**
- Create: `src/core/ids.ts`
- Create: `src/core/nodes.ts`
- Create: `tests/core/ids.test.ts`
- Create: `tests/core/nodes.test.ts`

**Step 1: Write failing test for ID generation**

`tests/core/ids.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { generateId } from '../../src/core/ids.js';

describe('generateId', () => {
  it('returns a string starting with kt-', () => {
    const id = generateId('test content');
    expect(id).toMatch(/^kt-[a-f0-9]{6}$/);
  });

  it('generates different IDs for same content (timestamp-based)', () => {
    const id1 = generateId('same content');
    const id2 = generateId('same content');
    expect(id1).not.toBe(id2);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/core/ids.test.ts
```

**Step 3: Implement ID generation**

`src/core/ids.ts`:
```typescript
import crypto from 'crypto';

export function generateId(content: string): string {
  const timestamp = Date.now().toString() + Math.random().toString();
  const hash = crypto
    .createHash('sha256')
    .update(`${content}|${timestamp}`)
    .digest('hex');
  return `kt-${hash.substring(0, 6)}`;
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/core/ids.test.ts
```

**Step 5: Write failing test for node CRUD**

`tests/core/nodes.test.ts`:
```typescript
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
```

**Step 6: Run test to verify it fails**

```bash
npx vitest run tests/core/nodes.test.ts
```

**Step 7: Implement nodes module**

`src/core/nodes.ts`:
```typescript
import { getDatabase } from '../db/connection.js';
import { generateId } from './ids.js';

export interface Node {
  id: string;
  namespace: string;
  title: string | null;
  content: string;
  status: 'active' | 'stale' | 'compacted';
  source_type: 'capture' | 'compaction';
  tags: string[] | null;
  embedding_pending: boolean;
  compacted_into: string | null;
  created_at: string;
  updated_at: string;
  stale_at: string | null;
  session_id: string | null;
}

interface CreateNodeInput {
  namespace: string;
  content: string;
  title?: string;
  tags?: string[];
  source_type?: 'capture' | 'compaction';
  session_id?: string;
}

interface ListNodesOptions {
  namespace?: string;
  status?: string;
  includeCompacted?: boolean;
  limit?: number;
}

function rowToNode(row: any): Node {
  return {
    ...row,
    tags: row.tags ? JSON.parse(row.tags) : null,
    embedding_pending: Boolean(row.embedding_pending),
  };
}

export function createNode(input: CreateNodeInput): Node {
  const db = getDatabase();
  const id = generateId(input.content);
  const tags = input.tags ? JSON.stringify(input.tags) : null;

  db.prepare(`
    INSERT INTO nodes (id, namespace, title, content, source_type, tags, embedding_pending, session_id)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    id,
    input.namespace,
    input.title || null,
    input.content,
    input.source_type || 'capture',
    tags,
    input.session_id || null,
  );

  return getNode(id)!;
}

export function getNode(id: string): Node | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
  return row ? rowToNode(row) : null;
}

export function listNodes(options: ListNodesOptions = {}): Node[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: any[] = [];

  if (options.namespace) {
    conditions.push('namespace = ?');
    params.push(options.namespace);
  }

  if (options.status) {
    conditions.push('status = ?');
    params.push(options.status);
  } else if (!options.includeCompacted) {
    conditions.push("status != 'compacted'");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit ? `LIMIT ${options.limit}` : '';

  const rows = db.prepare(
    `SELECT * FROM nodes ${where} ORDER BY updated_at DESC ${limit}`
  ).all(...params);

  return rows.map(rowToNode);
}

export function updateNodeStatus(id: string, status: 'active' | 'stale' | 'compacted'): void {
  const db = getDatabase();
  const updates: string[] = ['status = ?', "updated_at = datetime('now')"];
  const params: any[] = [status];

  if (status === 'stale') {
    updates.push("stale_at = datetime('now')");
  } else if (status === 'active') {
    updates.push('stale_at = NULL');
  }

  params.push(id);
  db.prepare(`UPDATE nodes SET ${updates.join(', ')} WHERE id = ?`).run(...params);
}

export function deleteNode(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM links WHERE source_id = ? OR target_id = ?').run(id, id);
  db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
}
```

**Step 8: Run tests to verify they pass**

```bash
npx vitest run tests/core/
```

Expected: ALL PASS

**Step 9: Commit**

```bash
git add src/core/ tests/core/
git commit -m "feat: node CRUD with ID generation and status transitions"
```

---

### Task 4: Links + Link-Driven Behavior

**Files:**
- Create: `src/core/links.ts`
- Create: `tests/core/links.test.ts`

**Step 1: Write failing test for links**

`tests/core/links.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, closeDatabase } from '../../src/db/connection.js';
import { createNode, getNode } from '../../src/core/nodes.js';
import { createLink, getLinks, getBacklinks } from '../../src/core/links.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('links', () => {
  const testDir = path.join(os.tmpdir(), 'kt-test-links-' + Date.now());
  const testDb = path.join(testDir, 'kt.db');

  beforeEach(() => {
    createDatabase(testDb);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('creates a related link between two nodes', () => {
    const a = createNode({ namespace: 'test', content: 'node a' });
    const b = createNode({ namespace: 'test', content: 'node b' });

    const link = createLink(a.id, 'related', b.id);
    expect(link.link_type).toBe('related');
    expect(link.source_id).toBe(a.id);
    expect(link.target_id).toBe(b.id);
  });

  it('supersedes link marks target as stale', () => {
    const old = createNode({ namespace: 'test', content: 'old insight' });
    const updated = createNode({ namespace: 'test', content: 'new insight' });

    createLink(updated.id, 'supersedes', old.id);

    const staleNode = getNode(old.id);
    expect(staleNode!.status).toBe('stale');
    expect(staleNode!.stale_at).toBeDefined();
  });

  it('contradicts link does NOT auto-stale either node', () => {
    const a = createNode({ namespace: 'test', content: 'view A' });
    const b = createNode({ namespace: 'test', content: 'view B' });

    createLink(a.id, 'contradicts', b.id);

    expect(getNode(a.id)!.status).toBe('active');
    expect(getNode(b.id)!.status).toBe('active');
  });

  it('gets outbound links for a node', () => {
    const a = createNode({ namespace: 'test', content: 'node a' });
    const b = createNode({ namespace: 'test', content: 'node b' });
    const c = createNode({ namespace: 'test', content: 'node c' });

    createLink(a.id, 'related', b.id);
    createLink(a.id, 'related', c.id);

    const links = getLinks(a.id);
    expect(links).toHaveLength(2);
  });

  it('gets backlinks for a node', () => {
    const a = createNode({ namespace: 'test', content: 'node a' });
    const b = createNode({ namespace: 'test', content: 'node b' });

    createLink(a.id, 'related', b.id);

    const backlinks = getBacklinks(b.id);
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].source_id).toBe(a.id);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/core/links.test.ts
```

**Step 3: Implement links module**

`src/core/links.ts`:
```typescript
import { getDatabase } from '../db/connection.js';
import { generateId } from './ids.js';
import { updateNodeStatus } from './nodes.js';

export interface Link {
  id: string;
  source_id: string;
  target_id: string;
  link_type: 'supersedes' | 'contradicts' | 'related';
  context: string | null;
  created_at: string;
}

export function createLink(
  sourceId: string,
  linkType: 'supersedes' | 'contradicts' | 'related',
  targetId: string,
  context?: string,
): Link {
  const db = getDatabase();
  const id = generateId(`${sourceId}-${linkType}-${targetId}`);

  db.prepare(`
    INSERT INTO links (id, source_id, target_id, link_type, context)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, sourceId, targetId, linkType, context || null);

  // Link-driven behavior: supersedes marks target stale
  if (linkType === 'supersedes') {
    updateNodeStatus(targetId, 'stale');
  }

  return db.prepare('SELECT * FROM links WHERE id = ?').get(id) as Link;
}

export function getLinks(nodeId: string): Link[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM links WHERE source_id = ? ORDER BY created_at DESC'
  ).all(nodeId) as Link[];
}

export function getBacklinks(nodeId: string): Link[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM links WHERE target_id = ? ORDER BY created_at DESC'
  ).all(nodeId) as Link[];
}

export function getConflicts(namespace?: string): { nodeA: string; nodeB: string; context: string | null }[] {
  const db = getDatabase();
  const query = namespace
    ? `SELECT l.source_id, l.target_id, l.context
       FROM links l
       JOIN nodes n1 ON l.source_id = n1.id
       JOIN nodes n2 ON l.target_id = n2.id
       WHERE l.link_type = 'contradicts'
       AND n1.status = 'active' AND n2.status = 'active'
       AND n1.namespace = ?`
    : `SELECT l.source_id, l.target_id, l.context
       FROM links l
       JOIN nodes n1 ON l.source_id = n1.id
       JOIN nodes n2 ON l.target_id = n2.id
       WHERE l.link_type = 'contradicts'
       AND n1.status = 'active' AND n2.status = 'active'`;

  const rows = namespace
    ? db.prepare(query).all(namespace)
    : db.prepare(query).all();

  return (rows as any[]).map(r => ({
    nodeA: r.source_id,
    nodeB: r.target_id,
    context: r.context,
  }));
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/core/links.test.ts
```

Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/core/links.ts tests/core/links.test.ts
git commit -m "feat: links with supersedes auto-stale behavior"
```

---

### Task 5: Namespaces + Project Mappings

**Files:**
- Create: `src/core/namespaces.ts`
- Create: `src/core/mappings.ts`
- Create: `tests/core/namespaces.test.ts`
- Create: `tests/core/mappings.test.ts`

**Step 1: Write failing test for namespaces**

`tests/core/namespaces.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, closeDatabase } from '../../src/db/connection.js';
import {
  createNamespace, listNamespaces, getNamespace, deleteNamespace,
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
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/core/namespaces.test.ts
```

**Step 3: Implement namespaces**

`src/core/namespaces.ts`:
```typescript
import { getDatabase } from '../db/connection.js';

export interface Namespace {
  slug: string;
  name: string;
  description: string | null;
}

export function createNamespace(slug: string, name: string, description?: string): Namespace {
  const db = getDatabase();
  db.prepare(`
    INSERT OR IGNORE INTO namespaces (slug, name, description) VALUES (?, ?, ?)
  `).run(slug, name, description || null);
  return getNamespace(slug)!;
}

export function ensureNamespace(slug: string): void {
  const db = getDatabase();
  db.prepare(`
    INSERT OR IGNORE INTO namespaces (slug, name) VALUES (?, ?)
  `).run(slug, slug);
}

export function getNamespace(slug: string): Namespace | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM namespaces WHERE slug = ?').get(slug);
  return (row as Namespace) || null;
}

export function listNamespaces(): Namespace[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM namespaces ORDER BY slug').all() as Namespace[];
}

export function deleteNamespace(slug: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM namespaces WHERE slug = ?').run(slug);
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/core/namespaces.test.ts
```

**Step 5: Write failing test for project mappings**

`tests/core/mappings.test.ts`:
```typescript
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
```

**Step 6: Run test to verify it fails**

```bash
npx vitest run tests/core/mappings.test.ts
```

**Step 7: Implement mappings**

`src/core/mappings.ts`:
```typescript
import { getDatabase } from '../db/connection.js';

export interface ProjectMapping {
  directory_pattern: string;
  namespace: string;
}

export function addMapping(directoryPattern: string, namespace: string): void {
  const db = getDatabase();
  db.prepare(`
    INSERT OR REPLACE INTO project_mappings (directory_pattern, namespace)
    VALUES (?, ?)
  `).run(directoryPattern, namespace);
}

export function listMappings(): ProjectMapping[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM project_mappings ORDER BY directory_pattern').all() as ProjectMapping[];
}

export function resolveNamespace(directory: string): string | null {
  const db = getDatabase();
  const mappings = db.prepare(
    'SELECT * FROM project_mappings ORDER BY length(directory_pattern) DESC'
  ).all() as ProjectMapping[];

  for (const mapping of mappings) {
    const pattern = mapping.directory_pattern.replace(/\/?\*$/, '');
    if (directory.startsWith(pattern)) {
      return mapping.namespace;
    }
  }

  return null;
}

export function removeMapping(directoryPattern: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM project_mappings WHERE directory_pattern = ?').run(directoryPattern);
}
```

**Step 8: Run all tests**

```bash
npx vitest run tests/core/
```

Expected: ALL PASS

**Step 9: Commit**

```bash
git add src/core/namespaces.ts src/core/mappings.ts tests/core/namespaces.test.ts tests/core/mappings.test.ts
git commit -m "feat: namespaces and project directory mappings"
```

---

### Task 6: Keyword Search

**Files:**
- Create: `src/core/search.ts`
- Create: `tests/core/search.test.ts`

**Step 1: Write failing test for keyword search**

`tests/core/search.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, closeDatabase } from '../../src/db/connection.js';
import { createNode } from '../../src/core/nodes.js';
import { searchNodes } from '../../src/core/search.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('keyword search', () => {
  const testDir = path.join(os.tmpdir(), 'kt-test-search-' + Date.now());
  const testDb = path.join(testDir, 'kt.db');

  beforeEach(() => {
    createDatabase(testDb);
    createNode({ namespace: 'test', content: 'Client X prefers quarterly planning cycles', title: 'Client X planning' });
    createNode({ namespace: 'test', content: 'Pricing model uses three tiers', title: 'Pricing tiers' });
    createNode({ namespace: 'test', content: 'Client Y rejected the sprint format', title: 'Client Y sprints' });
    createNode({ namespace: 'other', content: 'Unrelated knowledge in other namespace' });
  });

  afterEach(() => { closeDatabase(); fs.rmSync(testDir, { recursive: true, force: true }); });

  it('finds nodes matching content keyword', () => {
    const results = searchNodes('quarterly');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Client X planning');
  });

  it('finds nodes matching title keyword', () => {
    const results = searchNodes('Pricing');
    expect(results).toHaveLength(1);
  });

  it('filters by namespace', () => {
    const results = searchNodes('knowledge', { namespace: 'other' });
    expect(results).toHaveLength(1);
  });

  it('is case-insensitive', () => {
    const results = searchNodes('client');
    expect(results).toHaveLength(2); // Client X and Client Y
  });

  it('excludes compacted nodes', () => {
    const node = createNode({ namespace: 'test', content: 'compacted keyword match' });
    const db = (await import('../../src/db/connection.js')).getDatabase();
    db.prepare("UPDATE nodes SET status = 'compacted' WHERE id = ?").run(node.id);

    const results = searchNodes('compacted');
    expect(results).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/core/search.test.ts
```

**Step 3: Implement keyword search**

`src/core/search.ts`:
```typescript
import { getDatabase } from '../db/connection.js';
import type { Node } from './nodes.js';

interface SearchOptions {
  namespace?: string;
  limit?: number;
}

function rowToNode(row: any): Node {
  return {
    ...row,
    tags: row.tags ? JSON.parse(row.tags) : null,
    embedding_pending: Boolean(row.embedding_pending),
  };
}

export function searchNodes(query: string, options: SearchOptions = {}): Node[] {
  const db = getDatabase();
  const conditions: string[] = [
    "status != 'compacted'",
    "(title LIKE ? COLLATE NOCASE OR content LIKE ? COLLATE NOCASE)",
  ];
  const params: any[] = [`%${query}%`, `%${query}%`];

  if (options.namespace) {
    conditions.push('namespace = ?');
    params.push(options.namespace);
  }

  const limit = options.limit || 20;
  const where = `WHERE ${conditions.join(' AND ')}`;

  const rows = db.prepare(
    `SELECT * FROM nodes ${where} ORDER BY updated_at DESC LIMIT ?`
  ).all(...params, limit);

  return rows.map(rowToNode);
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
git commit -m "feat: keyword search across nodes"
```

---

### Task 7: Output Formatting

**Files:**
- Create: `src/cli/format.ts`
- Create: `tests/cli/format.test.ts`

**Step 1: Write failing test for formatters**

`tests/cli/format.test.ts`:
```typescript
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
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/cli/format.test.ts
```

**Step 3: Implement formatters**

`src/cli/format.ts`:
```typescript
import type { Node } from '../core/nodes.js';
import type { Link } from '../core/links.js';

export type Format = 'json' | 'human' | 'brief';

export function detectFormat(isTTY: boolean): Format {
  return isTTY ? 'human' : 'json';
}

export function formatNode(node: Node, format: Format, links?: Link[]): string {
  if (format === 'json') {
    return JSON.stringify(links ? { ...node, links } : node, null, 2);
  }

  if (format === 'brief') {
    return formatNodeBrief(node);
  }

  // Human format
  const lines: string[] = [];
  lines.push(`[${node.id}] ${node.title || '(untitled)'}`);
  lines.push(`  Status: ${node.status}  |  Namespace: ${node.namespace}  |  Updated: ${node.updated_at}`);
  if (node.tags) {
    lines.push(`  Tags: ${node.tags.join(', ')}`);
  }
  lines.push('');
  lines.push(node.content);

  if (links && links.length > 0) {
    lines.push('');
    lines.push('Links:');
    for (const link of links) {
      lines.push(`  ${link.link_type} → ${link.target_id}${link.context ? ` (${link.context})` : ''}`);
    }
  }

  return lines.join('\n');
}

export function formatNodeBrief(node: Node): string {
  const status = node.status === 'active' ? '' : ` [${node.status}]`;
  return `${node.id}  ${node.title || '(untitled)'}${status}  (${node.namespace})`;
}

export function formatNodeList(nodes: Node[], format: Format): string {
  if (format === 'json') {
    return JSON.stringify(nodes, null, 2);
  }

  if (nodes.length === 0) {
    return format === 'human' ? 'No results.' : '';
  }

  return nodes.map(n =>
    format === 'brief' ? formatNodeBrief(n) : formatNode(n, 'human')
  ).join('\n\n');
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/cli/format.test.ts
```

Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/cli/format.ts tests/cli/format.test.ts
git commit -m "feat: output formatters (json, human, brief)"
```

---

### Task 8: CLI Commands

**Files:**
- Create: `src/cli/commands/capture.ts`
- Create: `src/cli/commands/show.ts`
- Create: `src/cli/commands/search.ts`
- Create: `src/cli/commands/link.ts`
- Create: `src/cli/commands/status.ts`
- Create: `src/cli/commands/ns.ts`
- Create: `src/cli/commands/map.ts`
- Create: `src/cli/commands/stale.ts`
- Create: `src/cli/commands/stats.ts`
- Create: `src/cli/commands/delete.ts`
- Create: `src/cli/commands/context.ts`
- Modify: `src/index.ts`
- Create: `tests/cli/commands.test.ts`

**Step 1: Write integration test for CLI commands**

`tests/cli/commands.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Integration tests run the actual CLI binary
describe('CLI integration', () => {
  const testDir = path.join(os.tmpdir(), 'kt-cli-test-' + Date.now());
  const env = { ...process.env, KT_DB_PATH: path.join(testDir, 'kt.db') };

  function kt(args: string): string {
    return execSync(`npx tsx src/index.ts ${args}`, { env, encoding: 'utf-8' }).trim();
  }

  beforeEach(() => fs.mkdirSync(testDir, { recursive: true }));
  afterEach(() => fs.rmSync(testDir, { recursive: true, force: true }));

  it('capture creates a node and prints its ID', () => {
    const output = kt('capture "Test knowledge" --namespace test');
    expect(output).toMatch(/kt-[a-f0-9]{6}/);
  });

  it('show retrieves a captured node', () => {
    const id = kt('capture "Show me this" --namespace test').match(/kt-[a-f0-9]{6}/)![0];
    const output = kt(`show ${id} --format json`);
    const node = JSON.parse(output);
    expect(node.content).toBe('Show me this');
  });

  it('search finds nodes by keyword', () => {
    kt('capture "Quarterly planning preference" --namespace test');
    kt('capture "Sprint format rejected" --namespace test');
    const output = kt('search quarterly --format json');
    const results = JSON.parse(output);
    expect(results).toHaveLength(1);
  });

  it('ns create and list', () => {
    kt('ns create clients --name "Client Knowledge"');
    const output = kt('ns list --format json');
    const namespaces = JSON.parse(output);
    expect(namespaces.some((ns: any) => ns.slug === 'clients')).toBe(true);
  });

  it('link creates a relationship', () => {
    const id1 = kt('capture "Old insight" --namespace test').match(/kt-[a-f0-9]{6}/)![0];
    const id2 = kt('capture "New insight" --namespace test').match(/kt-[a-f0-9]{6}/)![0];
    kt(`link ${id2} supersedes ${id1}`);

    const output = kt(`show ${id1} --format json`);
    const node = JSON.parse(output);
    expect(node.status).toBe('stale');
  });

  it('stale lists stale nodes', () => {
    const id = kt('capture "Will go stale" --namespace test').match(/kt-[a-f0-9]{6}/)![0];
    kt(`status ${id} stale`);
    const output = kt('stale --format json');
    const nodes = JSON.parse(output);
    expect(nodes).toHaveLength(1);
  });

  it('stats shows counts', () => {
    kt('capture "Node 1" --namespace a');
    kt('capture "Node 2" --namespace a');
    kt('capture "Node 3" --namespace b');
    const output = kt('stats --format json');
    const stats = JSON.parse(output);
    expect(stats.total).toBe(3);
  });

  it('context returns structured brief', () => {
    kt('ns create test --name "Test"');
    kt('capture "Important knowledge" --namespace test');
    const output = kt('context --namespace test --format json');
    const ctx = JSON.parse(output);
    expect(ctx.namespace).toBe('test');
    expect(ctx.active_nodes.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/cli/commands.test.ts
```

**Step 3: Implement each CLI command**

`src/cli/commands/capture.ts`:
```typescript
import { Command } from 'commander';
import { createNode } from '../../core/nodes.js';
import { ensureNamespace } from '../../core/namespaces.js';
import { resolveNamespace } from '../../core/mappings.js';

export function captureCommand(): Command {
  return new Command('capture')
    .description('Capture knowledge')
    .argument('<content>', 'The knowledge to capture')
    .option('-n, --namespace <ns>', 'Namespace')
    .option('-t, --title <title>', 'Title for the node')
    .option('--tags <tags>', 'Comma-separated tags')
    .action((content, options) => {
      const namespace = options.namespace || resolveNamespace(process.cwd()) || 'default';
      ensureNamespace(namespace);

      const tags = options.tags ? options.tags.split(',').map((t: string) => t.trim()) : undefined;

      const node = createNode({
        namespace,
        content,
        title: options.title,
        tags,
      });

      console.log(node.id);
    });
}
```

`src/cli/commands/show.ts`:
```typescript
import { Command } from 'commander';
import { getNode } from '../../core/nodes.js';
import { getLinks } from '../../core/links.js';
import { formatNode, detectFormat, type Format } from '../format.js';

export function showCommand(): Command {
  return new Command('show')
    .description('Show a knowledge node')
    .argument('<id>', 'Node ID')
    .option('-f, --format <fmt>', 'Output format (json|human|brief)')
    .option('--with-links', 'Include outbound links')
    .action((id, options) => {
      const node = getNode(id);
      if (!node) {
        console.error(`Node ${id} not found`);
        process.exit(1);
      }

      const format: Format = options.format || detectFormat(Boolean(process.stdout.isTTY));
      const links = options.withLinks ? getLinks(id) : undefined;
      console.log(formatNode(node, format, links));
    });
}
```

`src/cli/commands/search.ts`:
```typescript
import { Command } from 'commander';
import { searchNodes } from '../../core/search.js';
import { formatNodeList, detectFormat, type Format } from '../format.js';

export function searchCommand(): Command {
  return new Command('search')
    .description('Search knowledge nodes')
    .argument('<query>', 'Search query')
    .option('-n, --namespace <ns>', 'Filter by namespace')
    .option('-k, --limit <number>', 'Max results', '10')
    .option('-f, --format <fmt>', 'Output format (json|human|brief)')
    .action((query, options) => {
      const results = searchNodes(query, {
        namespace: options.namespace,
        limit: parseInt(options.limit),
      });

      const format: Format = options.format || detectFormat(Boolean(process.stdout.isTTY));
      console.log(formatNodeList(results, format));
    });
}
```

`src/cli/commands/link.ts`:
```typescript
import { Command } from 'commander';
import { createLink } from '../../core/links.js';

export function linkCommand(): Command {
  return new Command('link')
    .description('Link two knowledge nodes')
    .argument('<source>', 'Source node ID')
    .argument('<type>', 'Link type: supersedes|contradicts|related')
    .argument('<target>', 'Target node ID')
    .option('-c, --context <text>', 'Why this link exists')
    .action((source, type, target, options) => {
      if (!['supersedes', 'contradicts', 'related'].includes(type)) {
        console.error(`Invalid link type: ${type}. Must be: supersedes, contradicts, related`);
        process.exit(1);
      }

      const link = createLink(source, type, target, options.context);
      console.log(`Linked: ${source} ${type} ${target}`);
    });
}
```

`src/cli/commands/status.ts`:
```typescript
import { Command } from 'commander';
import { updateNodeStatus, getNode } from '../../core/nodes.js';

export function statusCommand(): Command {
  return new Command('status')
    .description('Update node status')
    .argument('<id>', 'Node ID')
    .argument('<status>', 'New status: active|stale')
    .action((id, status) => {
      if (!['active', 'stale'].includes(status)) {
        console.error('Status must be: active, stale');
        process.exit(1);
      }

      const node = getNode(id);
      if (!node) {
        console.error(`Node ${id} not found`);
        process.exit(1);
      }

      updateNodeStatus(id, status as 'active' | 'stale');
      console.log(`${id} → ${status}`);
    });
}
```

`src/cli/commands/delete.ts`:
```typescript
import { Command } from 'commander';
import { deleteNode, getNode } from '../../core/nodes.js';

export function deleteCommand(): Command {
  return new Command('delete')
    .description('Delete a knowledge node')
    .argument('<id>', 'Node ID')
    .action((id) => {
      const node = getNode(id);
      if (!node) {
        console.error(`Node ${id} not found`);
        process.exit(1);
      }

      deleteNode(id);
      console.log(`Deleted ${id}`);
    });
}
```

`src/cli/commands/ns.ts`:
```typescript
import { Command } from 'commander';
import { createNamespace, listNamespaces, deleteNamespace } from '../../core/namespaces.js';
import { detectFormat, type Format } from '../format.js';

export function nsCommand(): Command {
  const ns = new Command('ns').description('Manage namespaces');

  ns.command('create')
    .argument('<slug>', 'Namespace slug')
    .option('--name <name>', 'Display name')
    .option('--description <desc>', 'Description')
    .action((slug, options) => {
      createNamespace(slug, options.name || slug, options.description);
      console.log(`Created namespace: ${slug}`);
    });

  ns.command('list')
    .option('-f, --format <fmt>', 'Output format')
    .action((options) => {
      const namespaces = listNamespaces();
      const format: Format = options.format || detectFormat(Boolean(process.stdout.isTTY));

      if (format === 'json') {
        console.log(JSON.stringify(namespaces, null, 2));
      } else {
        if (namespaces.length === 0) {
          console.log('No namespaces.');
        } else {
          for (const ns of namespaces) {
            console.log(`${ns.slug}  ${ns.name}${ns.description ? '  — ' + ns.description : ''}`);
          }
        }
      }
    });

  ns.command('delete')
    .argument('<slug>', 'Namespace slug')
    .action((slug) => {
      deleteNamespace(slug);
      console.log(`Deleted namespace: ${slug}`);
    });

  return ns;
}
```

`src/cli/commands/map.ts`:
```typescript
import { Command } from 'commander';
import { addMapping, listMappings, removeMapping } from '../../core/mappings.js';
import { ensureNamespace } from '../../core/namespaces.js';
import { detectFormat, type Format } from '../format.js';

export function mapCommand(): Command {
  const map = new Command('map').description('Map directories to namespaces');

  map.command('add')
    .argument('<directory>', 'Directory pattern')
    .argument('<namespace>', 'Namespace slug')
    .action((directory, namespace) => {
      ensureNamespace(namespace);
      addMapping(directory, namespace);
      console.log(`Mapped: ${directory} → ${namespace}`);
    });

  map.command('list')
    .option('-f, --format <fmt>', 'Output format')
    .action((options) => {
      const mappings = listMappings();
      const format: Format = options.format || detectFormat(Boolean(process.stdout.isTTY));

      if (format === 'json') {
        console.log(JSON.stringify(mappings, null, 2));
      } else {
        if (mappings.length === 0) {
          console.log('No mappings.');
        } else {
          for (const m of mappings) {
            console.log(`${m.directory_pattern} → ${m.namespace}`);
          }
        }
      }
    });

  map.command('remove')
    .argument('<directory>', 'Directory pattern')
    .action((directory) => {
      removeMapping(directory);
      console.log(`Removed mapping: ${directory}`);
    });

  return map;
}
```

`src/cli/commands/stale.ts`:
```typescript
import { Command } from 'commander';
import { listNodes } from '../../core/nodes.js';
import { formatNodeList, detectFormat, type Format } from '../format.js';

export function staleCommand(): Command {
  return new Command('stale')
    .description('List stale knowledge nodes')
    .option('-n, --namespace <ns>', 'Filter by namespace')
    .option('-f, --format <fmt>', 'Output format')
    .action((options) => {
      const nodes = listNodes({ status: 'stale', namespace: options.namespace });
      const format: Format = options.format || detectFormat(Boolean(process.stdout.isTTY));
      console.log(formatNodeList(nodes, format));
    });
}
```

`src/cli/commands/stats.ts`:
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
      };

      const format: Format = options.format || detectFormat(Boolean(process.stdout.isTTY));

      if (format === 'json') {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log(`Total: ${total}  (active: ${active}, stale: ${stale}, compacted: ${compacted})`);
        console.log(`Pending embeddings: ${pending}`);
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

`src/cli/commands/context.ts`:
```typescript
import { Command } from 'commander';
import { listNodes } from '../../core/nodes.js';
import { getConflicts } from '../../core/links.js';
import { resolveNamespace } from '../../core/mappings.js';
import { detectFormat, type Format } from '../format.js';

interface ContextBrief {
  namespace: string | null;
  loaded_at: string;
  active_nodes: {
    id: string;
    title: string | null;
    summary: string;
    updated_at: string;
  }[];
  conflicts: {
    node_a: string;
    node_b: string;
    description: string | null;
  }[];
  stale_alerts: {
    id: string;
    title: string | null;
    stale_since: string | null;
  }[];
}

export function contextCommand(): Command {
  return new Command('context')
    .description('Load context brief for current project')
    .option('-n, --namespace <ns>', 'Namespace (auto-detected from cwd if omitted)')
    .option('-l, --limit <number>', 'Max active nodes', '5')
    .option('-f, --format <fmt>', 'Output format')
    .action((options) => {
      const namespace = options.namespace || resolveNamespace(process.cwd()) || null;
      const limit = parseInt(options.limit);

      const activeNodes = listNodes({
        namespace: namespace || undefined,
        status: 'active',
        limit,
      });

      const staleNodes = listNodes({
        namespace: namespace || undefined,
        status: 'stale',
        limit: 3,
      });

      const conflicts = getConflicts(namespace || undefined);

      const brief: ContextBrief = {
        namespace,
        loaded_at: new Date().toISOString(),
        active_nodes: activeNodes.map(n => ({
          id: n.id,
          title: n.title,
          summary: n.content.substring(0, 200) + (n.content.length > 200 ? '...' : ''),
          updated_at: n.updated_at,
        })),
        conflicts: conflicts.map(c => ({
          node_a: c.nodeA,
          node_b: c.nodeB,
          description: c.context,
        })),
        stale_alerts: staleNodes.map(n => ({
          id: n.id,
          title: n.title,
          stale_since: n.stale_at,
        })),
      };

      const format: Format = options.format || detectFormat(Boolean(process.stdout.isTTY));

      if (format === 'json') {
        console.log(JSON.stringify(brief, null, 2));
      } else {
        console.log(`Context: ${namespace || '(all namespaces)'}`);
        console.log('');
        if (brief.active_nodes.length > 0) {
          console.log('Active knowledge:');
          for (const n of brief.active_nodes) {
            console.log(`  [${n.id}] ${n.title || '(untitled)'}`);
            console.log(`    ${n.summary}`);
          }
        }
        if (brief.conflicts.length > 0) {
          console.log('\nConflicts:');
          for (const c of brief.conflicts) {
            console.log(`  ${c.node_a} contradicts ${c.node_b}${c.description ? ': ' + c.description : ''}`);
          }
        }
        if (brief.stale_alerts.length > 0) {
          console.log('\nStale:');
          for (const n of brief.stale_alerts) {
            console.log(`  [${n.id}] ${n.title || '(untitled)'} — stale since ${n.stale_since}`);
          }
        }
      }
    });
}
```

**Step 4: Wire up the main entry point**

`src/index.ts`:
```typescript
#!/usr/bin/env node

import { Command } from 'commander';
import { createDatabase, getDefaultDbPath } from './db/connection.js';
import { captureCommand } from './cli/commands/capture.js';
import { showCommand } from './cli/commands/show.js';
import { searchCommand } from './cli/commands/search.js';
import { linkCommand } from './cli/commands/link.js';
import { statusCommand } from './cli/commands/status.js';
import { deleteCommand } from './cli/commands/delete.js';
import { nsCommand } from './cli/commands/ns.js';
import { mapCommand } from './cli/commands/map.js';
import { staleCommand } from './cli/commands/stale.js';
import { statsCommand } from './cli/commands/stats.js';
import { contextCommand } from './cli/commands/context.js';

// Initialize database
const dbPath = process.env.KT_DB_PATH || getDefaultDbPath();
createDatabase(dbPath);

const program = new Command()
  .name('kt')
  .description('Knowledge Tracker — CLI-first knowledge management for AI agents')
  .version('0.1.0');

program.addCommand(captureCommand());
program.addCommand(showCommand());
program.addCommand(searchCommand());
program.addCommand(linkCommand());
program.addCommand(statusCommand());
program.addCommand(deleteCommand());
program.addCommand(nsCommand());
program.addCommand(mapCommand());
program.addCommand(staleCommand());
program.addCommand(statsCommand());
program.addCommand(contextCommand());

program.parse();
```

**Step 5: Run integration tests**

```bash
npx vitest run tests/cli/commands.test.ts
```

Expected: ALL PASS (iterate on failures — these are integration tests, expect some debugging)

**Step 6: Run all tests**

```bash
npx vitest run
```

Expected: ALL PASS

**Step 7: Commit**

```bash
git add src/cli/ src/index.ts tests/cli/
git commit -m "feat: full CLI with all Phase 1 commands"
```

---

### Task 9: Global Install + Manual Smoke Test

**Files:**
- Modify: `package.json` (verify bin field)

**Step 1: Build the project**

```bash
npx tsc
```

Expected: No errors

**Step 2: Link globally**

```bash
npm link
```

**Step 3: Smoke test the CLI**

```bash
# Should show help
kt --help

# Create a namespace
kt ns create test --name "Test Namespace"

# Capture some knowledge
kt capture "TypeScript is the recommended language for Phase 1" --namespace test --title "Language decision"

# Search
kt search "TypeScript"

# Show
kt show <id-from-capture>

# Context
kt context --namespace test

# Stats
kt stats

# Link two nodes
kt capture "Go might be better for distribution" --namespace test --title "Go consideration"
kt link <new-id> contradicts <old-id> --context "Single binary vs Node.js runtime"

# Check context shows the conflict
kt context --namespace test

# Map a directory
kt map add ~/GitHub/kt test

# Stale list
kt stale
```

**Step 4: Verify ~/.kt/ was created**

```bash
ls -la ~/.kt/
```

Expected: `kt.db` exists

**Step 5: Commit any fixes from smoke testing**

```bash
git add -A
git commit -m "fix: adjustments from smoke testing"
```

---

### Task 10: Final Cleanup + Tag

**Step 1: Run full test suite one more time**

```bash
npx vitest run
```

Expected: ALL PASS

**Step 2: Add a minimal README**

Create `README.md`:
```markdown
# kt — Knowledge Tracker

CLI-first knowledge management for AI agents.

## Install

```bash
npm install -g kt
```

## Quick Start

```bash
kt ns create my-project
kt capture "Important insight" --namespace my-project
kt search "insight"
kt context --namespace my-project
```

## Status

Phase 1 — Foundation. Keyword search, manual capture, basic context loading.
```

**Step 3: Final commit + tag**

```bash
git add -A
git commit -m "docs: minimal README"
git tag v0.1.0
```

Phase 1 complete.
