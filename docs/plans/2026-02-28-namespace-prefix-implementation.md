# Multi-Instance kt with Hierarchical Namespaces — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable per-vault kt databases with auto-derived hierarchical namespaces and depth-inclusive prefix matching.

**Architecture:** Walk-up database resolution (like git), folder-path-to-namespace derivation with 3-level cap, SQL LIKE prefix matching across all namespace-filtered queries.

**Tech Stack:** TypeScript, SQLite (better-sqlite3), sqlite-vec, Vitest

---

### Task 1: namespaceFilter helper + unit tests

**Files:**
- Create: `src/core/namespace-filter.ts`
- Create: `tests/core/namespace-filter.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/core/namespace-filter.test.ts
import { describe, it, expect } from 'vitest';
import { namespaceFilter } from '../../src/core/namespace-filter.js';

describe('namespaceFilter', () => {
  it('returns SQL that matches exact namespace and dot-children', () => {
    const filter = namespaceFilter('clients');
    expect(filter.sql).toBe('(namespace = ? OR namespace LIKE ?)');
    expect(filter.params).toEqual(['clients', 'clients.%']);
  });

  it('handles dotted namespace', () => {
    const filter = namespaceFilter('clients.google');
    expect(filter.params).toEqual(['clients.google', 'clients.google.%']);
  });

  it('returns null filter when namespace is undefined', () => {
    const filter = namespaceFilter(undefined);
    expect(filter).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/namespace-filter.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/core/namespace-filter.ts
interface NamespaceFilterResult {
  sql: string;
  params: string[];
}

export function namespaceFilter(ns: string | undefined): NamespaceFilterResult | null {
  if (!ns) return null;
  return {
    sql: '(namespace = ? OR namespace LIKE ?)',
    params: [ns, `${ns}.%`],
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/namespace-filter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/namespace-filter.ts tests/core/namespace-filter.test.ts
git commit -m "feat: add namespaceFilter helper for prefix matching"
```

---

### Task 2: Update ensureNamespace to auto-create parent prefixes

**Files:**
- Modify: `src/core/namespaces.ts:17-22`
- Modify: `tests/core/namespaces.test.ts`

**Step 1: Write the failing test**

Add to `tests/core/namespaces.test.ts`:

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/namespaces.test.ts`
Expected: FAIL — `clients` namespace not found (only `clients.google.workshop` gets created)

**Step 3: Write minimal implementation**

Replace `ensureNamespace` in `src/core/namespaces.ts`:

```typescript
export function ensureNamespace(slug: string): void {
  const db = getDatabase();
  const parts = slug.split('.');
  for (let i = 1; i <= parts.length; i++) {
    const prefix = parts.slice(0, i).join('.');
    db.prepare(`
      INSERT OR IGNORE INTO namespaces (slug, name) VALUES (?, ?)
    `).run(prefix, prefix);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/namespaces.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/namespaces.ts tests/core/namespaces.test.ts
git commit -m "feat: ensureNamespace auto-creates parent prefixes"
```

---

### Task 3: Database resolution — resolveDatabase with walk-up

**Files:**
- Modify: `src/db/connection.ts`
- Create: `tests/db/resolve-database.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/db/resolve-database.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveDatabase } from '../../src/db/connection.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('resolveDatabase', () => {
  const testDir = path.join(os.tmpdir(), 'kt-resolve-db-' + Date.now());
  const vaultRoot = path.join(testDir, 'my-vault');
  const subDir = path.join(vaultRoot, 'clients', 'google');

  beforeEach(() => {
    fs.mkdirSync(subDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('finds .kt/kt.db walking up from subdirectory', () => {
    const ktDir = path.join(vaultRoot, '.kt');
    fs.mkdirSync(ktDir);
    fs.writeFileSync(path.join(ktDir, 'kt.db'), ''); // placeholder

    const result = resolveDatabase(subDir);
    expect(result.dbPath).toBe(path.join(ktDir, 'kt.db'));
    expect(result.vaultRoot).toBe(vaultRoot);
  });

  it('returns global fallback when no .kt/ found', () => {
    const result = resolveDatabase(subDir);
    expect(result.dbPath).toContain('.kt/kt.db');
    expect(result.vaultRoot).toBeNull();
  });

  it('KT_DB_PATH env var overrides everything', () => {
    const customPath = path.join(testDir, 'custom.db');
    const result = resolveDatabase(subDir, customPath);
    expect(result.dbPath).toBe(customPath);
    expect(result.vaultRoot).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/resolve-database.test.ts`
Expected: FAIL — `resolveDatabase` not exported

**Step 3: Write minimal implementation**

Add to `src/db/connection.ts`:

```typescript
import path from 'path';
import fs from 'fs';
import os from 'os';

interface DatabaseResolution {
  dbPath: string;
  vaultRoot: string | null;
}

export function resolveDatabase(cwd: string, envOverride?: string): DatabaseResolution {
  // Env var overrides everything
  if (envOverride) {
    return { dbPath: envOverride, vaultRoot: null };
  }

  // Walk up looking for .kt/kt.db
  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;

  while (dir !== root) {
    const candidate = path.join(dir, '.kt', 'kt.db');
    if (fs.existsSync(path.join(dir, '.kt'))) {
      return { dbPath: candidate, vaultRoot: dir };
    }
    dir = path.dirname(dir);
  }

  // Fallback to global
  const globalDir = path.join(os.homedir(), '.kt');
  return { dbPath: path.join(globalDir, 'kt.db'), vaultRoot: null };
}
```

Then update `getDatabase()` / `createDatabase()` to use `resolveDatabase()` when no explicit path is given. The existing `KT_DB_PATH` env var flows through as `envOverride`.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db/resolve-database.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db/connection.ts tests/db/resolve-database.test.ts
git commit -m "feat: walk-up database resolution (.kt/ per vault)"
```

---

### Task 4: Vault-aware resolveNamespace

**Files:**
- Modify: `src/core/mappings.ts:21-35`
- Modify: `tests/core/mappings.test.ts`

**Step 1: Write the failing test**

Add to `tests/core/mappings.test.ts`:

```typescript
describe('vault-local resolution', () => {
  it('derives namespace from relative path to vault root', () => {
    const ns = resolveNamespaceFromVault(
      '/path/to/vault/clients/google',
      '/path/to/vault'
    );
    expect(ns).toBe('clients.google');
  });

  it('caps at 3 levels', () => {
    const ns = resolveNamespaceFromVault(
      '/path/to/vault/clients/google/workshop/day-1',
      '/path/to/vault'
    );
    expect(ns).toBe('clients.google.workshop');
  });

  it('returns null at vault root', () => {
    const ns = resolveNamespaceFromVault(
      '/path/to/vault',
      '/path/to/vault'
    );
    expect(ns).toBeNull();
  });

  it('handles single level', () => {
    const ns = resolveNamespaceFromVault(
      '/path/to/vault/clients',
      '/path/to/vault'
    );
    expect(ns).toBe('clients');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/mappings.test.ts`
Expected: FAIL — `resolveNamespaceFromVault` not exported

**Step 3: Write minimal implementation**

Add to `src/core/mappings.ts`:

```typescript
const MAX_NAMESPACE_DEPTH = 3;

export function resolveNamespaceFromVault(cwd: string, vaultRoot: string): string | null {
  const relative = path.relative(vaultRoot, cwd);
  if (!relative || relative === '.') return null;

  const segments = relative.split(path.sep).filter(Boolean);
  const capped = segments.slice(0, MAX_NAMESPACE_DEPTH);
  return capped.join('.');
}
```

Then update the main `resolveNamespace()` to check for vault context first:

```typescript
export function resolveNamespace(directory: string, vaultRoot?: string | null): string | null {
  // Vault-local: derive from folder path
  if (vaultRoot) {
    return resolveNamespaceFromVault(directory, vaultRoot);
  }

  // Global fallback: use project_mappings (existing logic)
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
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/mappings.test.ts`
Expected: PASS (both old and new tests)

**Step 5: Commit**

```bash
git add src/core/mappings.ts tests/core/mappings.test.ts
git commit -m "feat: vault-aware namespace resolution from folder depth"
```

---

### Task 5: Apply namespaceFilter to core modules

**Files:**
- Modify: `src/core/nodes.ts:76-79`
- Modify: `src/core/search.ts:27-30` and `75-78`
- Modify: `src/core/staleness.ts:32-34` and `66-68`
- Modify: `src/core/links.ts:52-77`
- Modify: `src/core/clustering.ts:24-27`
- Modify: `tests/core/search.test.ts`

**Step 1: Write the failing test**

Add to `tests/core/search.test.ts`:

```typescript
it('prefix-matches namespace with dot children', () => {
  createNode({ namespace: 'clients', content: 'Top-level client knowledge' });
  createNode({ namespace: 'clients.google', content: 'Google project knowledge' });
  createNode({ namespace: 'clients.hpi', content: 'HPI project knowledge' });
  createNode({ namespace: 'other', content: 'Unrelated knowledge' });

  const results = searchNodes('knowledge', { namespace: 'clients' });
  expect(results).toHaveLength(3);
  expect(results.every(r => r.namespace.startsWith('clients'))).toBe(true);
});

it('does not match upward from child namespace', () => {
  createNode({ namespace: 'clients', content: 'Top-level' });
  createNode({ namespace: 'clients.google', content: 'Google specific' });

  const results = searchNodes('', { namespace: 'clients.google' });
  expect(results.every(r => r.namespace === 'clients.google')).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/search.test.ts`
Expected: FAIL — `searchNodes('knowledge', { namespace: 'clients' })` returns only 1 result (exact match)

**Step 3: Apply namespaceFilter to all 6 core modules**

Import the helper in each file and replace the `namespace = ?` pattern:

```typescript
import { namespaceFilter } from './namespace-filter.js';

// Before:
if (options.namespace) {
  conditions.push('namespace = ?');
  params.push(options.namespace);
}

// After:
const nsFilter = namespaceFilter(options.namespace);
if (nsFilter) {
  conditions.push(nsFilter.sql);
  params.push(...nsFilter.params);
}
```

Apply this pattern to:
- `nodes.ts` → `listNodes()` (line 76-79)
- `search.ts` → `searchNodes()` (line 27-30)
- `search.ts` → `semanticSearch()` (line 75-78)
- `staleness.ts` → `detectStaleNodes()` primary scan (line 32-34)
- `staleness.ts` → `detectStaleNodes()` orphan scan (line 66-68, also update line 79-81 to pass both params)
- `clustering.ts` → `detectClusters()` (line 24-27)

For `links.ts` → `getConflicts()` (line 52-77), the pattern is different because it uses inline SQL with a ternary. Refactor to use the helper:

```typescript
export function getConflicts(namespace?: string): { nodeA: string; nodeB: string; context: string | null }[] {
  const db = getDatabase();
  const nsFilter = namespaceFilter(namespace);
  const nsClause = nsFilter ? `AND ${nsFilter.sql}` : '';
  const nsParams = nsFilter ? nsFilter.params : [];

  const query = `SELECT l.source_id, l.target_id, l.context
    FROM links l
    JOIN nodes n1 ON l.source_id = n1.id
    JOIN nodes n2 ON l.target_id = n2.id
    WHERE l.link_type = 'contradicts'
    AND n1.status = 'active' AND n2.status = 'active'
    ${nsClause.replace('namespace', 'n1.namespace')}`;

  const rows = db.prepare(query).all(...nsParams);
  return (rows as any[]).map(r => ({
    nodeA: r.source_id,
    nodeB: r.target_id,
    context: r.context,
  }));
}
```

Note: Replace `namespace` with `n1.namespace` in the SQL since this is a JOIN query.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/search.test.ts`
Expected: PASS

Then run full suite: `npx vitest run`
Expected: All passing (update any tests that assumed exact matching)

**Step 5: Commit**

```bash
git add src/core/nodes.ts src/core/search.ts src/core/staleness.ts src/core/links.ts src/core/clustering.ts tests/core/search.test.ts
git commit -m "feat: apply prefix matching to all core namespace queries"
```

---

### Task 6: Apply namespaceFilter to CLI commands and MCP tools

**Files:**
- Modify: `src/cli/commands/stats.ts:26-27`
- Modify: `src/cli/commands/context.ts:55-57`
- Modify: `src/mcp/tools.ts:64-80`
- Modify: `tests/cli/commands.test.ts`

**Step 1: Update stats.ts**

Replace the `nsFilter` string construction:

```typescript
// Before:
const nsFilter = ns ? ' AND namespace = ?' : '';
const nsParams = ns ? [ns] : [];

// After:
import { namespaceFilter } from '../../core/namespace-filter.js';
const nsf = namespaceFilter(ns);
const nsFilter = nsf ? ` AND ${nsf.sql}` : '';
const nsParams = nsf ? nsf.params : [];
```

Also update the `byNs` GROUP BY query to use prefix filter:

```typescript
const byNs = nsf
  ? db.prepare(
      `SELECT namespace, COUNT(*) as count FROM nodes WHERE status != 'compacted' AND ${nsf.sql} GROUP BY namespace ORDER BY count DESC`
    ).all(...nsf.params) as { namespace: string; count: number }[]
  : db.prepare(
      "SELECT namespace, COUNT(*) as count FROM nodes WHERE status != 'compacted' GROUP BY namespace ORDER BY count DESC"
    ).all() as { namespace: string; count: number }[];
```

**Step 2: Update context.ts**

Replace the direct count query:

```typescript
import { namespaceFilter } from '../../core/namespace-filter.js';

const nsf = namespaceFilter(namespace);
const countQuery = nsf
  ? db.prepare(`SELECT COUNT(*) as c FROM nodes WHERE status = 'active' AND ${nsf.sql}`).get(...nsf.params)
  : db.prepare("SELECT COUNT(*) as c FROM nodes WHERE status = 'active'").get();
```

**Step 3: Update mcp/tools.ts handleContext**

Replace the three raw `namespace = ?` queries with the filter helper. Same pattern — import `namespaceFilter`, construct the clause, spread the params.

**Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All passing

**Step 5: Commit**

```bash
git add src/cli/commands/stats.ts src/cli/commands/context.ts src/mcp/tools.ts tests/cli/commands.test.ts
git commit -m "feat: apply prefix matching to CLI commands and MCP tools"
```

---

### Task 7: kt init command

**Files:**
- Create: `src/cli/commands/init.ts`
- Modify: `src/index.ts` (register command)
- Create: `tests/cli/init.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/cli/init.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('kt init', () => {
  const testDir = path.join(os.tmpdir(), 'kt-init-test-' + Date.now());

  afterEach(() => fs.rmSync(testDir, { recursive: true, force: true }));

  it('creates .kt directory with database', () => {
    fs.mkdirSync(testDir, { recursive: true });
    execSync(`npx tsx src/index.ts init`, { cwd: testDir, encoding: 'utf-8' });

    expect(fs.existsSync(path.join(testDir, '.kt'))).toBe(true);
    expect(fs.existsSync(path.join(testDir, '.kt', 'kt.db'))).toBe(true);
  });

  it('refuses to init if .kt already exists', () => {
    fs.mkdirSync(path.join(testDir, '.kt'), { recursive: true });
    const output = execSync(`npx tsx src/index.ts init`, { cwd: testDir, encoding: 'utf-8' });
    expect(output).toContain('already initialized');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/init.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// src/cli/commands/init.ts
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { createDatabase, closeDatabase } from '../../db/connection.js';

export function initCommand(): Command {
  return new Command('init')
    .description('Initialize a kt knowledge base in the current directory')
    .action(() => {
      const ktDir = path.join(process.cwd(), '.kt');

      if (fs.existsSync(ktDir)) {
        console.log('kt already initialized in this directory.');
        return;
      }

      fs.mkdirSync(ktDir, { recursive: true });
      const dbPath = path.join(ktDir, 'kt.db');
      createDatabase(dbPath);
      closeDatabase();

      console.log(`Initialized kt in ${ktDir}`);
      console.log('Knowledge base ready. Use `kt capture` to start.');
    });
}
```

Register in `src/index.ts`.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/init.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli/commands/init.ts src/index.ts tests/cli/init.test.ts
git commit -m "feat: add kt init command for per-vault databases"
```

---

### Task 8: Wire database resolution into getDatabase

**Files:**
- Modify: `src/db/connection.ts`
- Modify: CLI entry points that call `getDatabase()`

**Step 1: Update connection.ts**

Modify `getDatabase()` to call `resolveDatabase(process.cwd(), process.env.KT_DB_PATH)` when no database is open. Store the resolved `vaultRoot` so `resolveNamespace` can access it.

```typescript
let currentVaultRoot: string | null = null;

export function getVaultRoot(): string | null {
  return currentVaultRoot;
}

// Update getDatabase() to resolve path and store vault root
```

**Step 2: Update resolveNamespace callers**

Update all callers of `resolveNamespace(process.cwd())` to pass the vault root:

```typescript
import { getVaultRoot } from '../db/connection.js';
const namespace = resolveNamespace(process.cwd(), getVaultRoot());
```

This affects:
- `src/cli/commands/context.ts:50`
- `src/cli/commands/capture.ts:17`
- `src/cli/commands/digest.ts:24`
- `src/index.ts` (bare `kt` with no command)

**Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All passing. Tests use `KT_DB_PATH` env var which overrides walk-up resolution.

**Step 4: Commit**

```bash
git add src/db/connection.ts src/cli/commands/context.ts src/cli/commands/capture.ts src/cli/commands/digest.ts src/index.ts
git commit -m "feat: wire walk-up database resolution into getDatabase"
```

---

### Task 9: Integration test — full vault workflow

**Files:**
- Create: `tests/cli/vault-workflow.test.ts`

**Step 1: Write integration test**

```typescript
// tests/cli/vault-workflow.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('vault workflow', () => {
  const testDir = path.join(os.tmpdir(), 'kt-vault-test-' + Date.now());
  const vaultDir = path.join(testDir, 'my-vault');
  const clientsDir = path.join(vaultDir, 'clients');
  const googleDir = path.join(clientsDir, 'google');
  const deepDir = path.join(googleDir, 'q1', 'workshop');

  function kt(args: string, cwd: string): string {
    return execSync(`npx tsx src/index.ts ${args}`, { cwd, encoding: 'utf-8' }).trim();
  }

  beforeEach(() => {
    fs.mkdirSync(deepDir, { recursive: true });
    kt('init', vaultDir);
  });

  afterEach(() => fs.rmSync(testDir, { recursive: true, force: true }));

  it('captures into auto-derived namespace from folder depth', () => {
    const output = kt('capture "Google insight" --format json', googleDir);
    expect(output).toContain('clients.google');
  });

  it('caps namespace at 3 levels', () => {
    const output = kt('capture "Deep insight" --format json', deepDir);
    // q1/workshop is level 4+, should cap at clients.google.q1
    expect(output).toContain('clients.google.q1');
    expect(output).not.toContain('workshop');
  });

  it('auto-creates parent namespaces', () => {
    kt('capture "Google insight"', googleDir);
    const nsList = kt('ns list --format json', vaultDir);
    const namespaces = JSON.parse(nsList);
    const slugs = namespaces.map((n: any) => n.slug);
    expect(slugs).toContain('clients');
    expect(slugs).toContain('clients.google');
  });

  it('search from parent includes child namespaces', () => {
    kt('capture "Google insight about branding"', googleDir);
    kt('capture "HPI insight about research"', path.join(clientsDir, 'hpi'));
    // Search from clients/ should find both
    const results = kt('search insight --format json', clientsDir);
    const parsed = JSON.parse(results);
    expect(parsed.length).toBeGreaterThanOrEqual(2);
  });

  it('search from child does not include parent', () => {
    kt('capture "Top-level clients note"', clientsDir);
    kt('capture "Google-specific note"', googleDir);
    const results = kt('search note --format json', googleDir);
    const parsed = JSON.parse(results);
    expect(parsed.every((r: any) => r.namespace === 'clients.google')).toBe(true);
  });

  it('context from vault root shows all namespaces', () => {
    kt('capture "Client insight"', clientsDir);
    kt('capture "Google insight"', googleDir);
    const ctx = kt('context --format json', vaultDir);
    const parsed = JSON.parse(ctx);
    expect(parsed.total_nodes).toBe(2);
  });
});
```

**Step 2: Run test**

Run: `npx vitest run tests/cli/vault-workflow.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/cli/vault-workflow.test.ts
git commit -m "test: add vault workflow integration tests"
```

---

### Task 10: Final verification and cleanup

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All passing

**Step 2: Build check**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | grep -v "src/mcp/"`
Expected: No errors (excluding pre-existing MCP type issues)

**Step 3: Manual smoke test**

```bash
# Create a test vault
mkdir -p /tmp/test-vault/clients/google
cd /tmp/test-vault && kt init
cd /tmp/test-vault/clients/google && kt capture "Test capture"
cd /tmp/test-vault/clients && kt search "test"
cd /tmp/test-vault && kt context --format json
kt ns list
```

**Step 4: Commit any cleanup**

```bash
git commit -m "chore: final cleanup for namespace prefix feature"
```
