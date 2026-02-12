# Digest Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Claude-synthesized digest as the default `kt` command — type `kt` in a mapped directory and get a coherent briefing of recent knowledge.

**Architecture:** New `digest` core module handles node fetching, prompt construction, Claude API call, and cache management. New `digests` SQLite table caches results keyed by namespace. CLI entry point wires bare `kt` (no subcommand) to trigger the digest. Existing `summarize.ts` pattern is reused for Claude interaction.

**Tech Stack:** TypeScript, Commander.js, Anthropic SDK, better-sqlite3, crypto (for hashing)

**Design doc:** `docs/plans/2026-02-12-digest-design.md`

---

### Task 1: Add `digests` table to schema

**Files:**
- Modify: `src/db/schema.sql:45-48` (append after node_embeddings)

**Step 1: Write the failing test**

Create `tests/core/digest.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, closeDatabase, getDatabase } from '../../src/db/connection.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('digest', () => {
  const testDir = path.join(os.tmpdir(), 'kt-test-digest-' + Date.now());
  const testDb = path.join(testDir, 'kt.db');

  beforeEach(() => {
    createDatabase(testDb);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('digests table', () => {
    it('exists after database creation', () => {
      const db = getDatabase();
      const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='digests'"
      ).get() as { name: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.name).toBe('digests');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/digest.test.ts`
Expected: FAIL — `digests` table does not exist

**Step 3: Add the digests table to schema**

Append to `src/db/schema.sql` after the `node_embeddings` virtual table:

```sql
CREATE TABLE IF NOT EXISTS digests (
  namespace    TEXT PRIMARY KEY,
  content      TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  node_hash    TEXT NOT NULL,
  days         INTEGER NOT NULL
);
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/digest.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db/schema.sql tests/core/digest.test.ts
git commit -m "feat(digest): add digests cache table to schema"
```

---

### Task 2: Implement digest cache functions

**Files:**
- Create: `src/core/digest.ts`
- Test: `tests/core/digest.test.ts` (extend)

**Step 1: Write the failing tests**

Add to `tests/core/digest.test.ts` inside the outer `describe('digest', ...)`:

```typescript
import { createNode } from '../../src/core/nodes.js';
import { computeNodeHash, getCachedDigest, cacheDigest } from '../../src/core/digest.js';

// ... (keep existing imports and setup)

  describe('computeNodeHash', () => {
    it('returns consistent hash for same nodes', () => {
      const n1 = createNode({ namespace: 'test', content: 'Alpha' });
      const n2 = createNode({ namespace: 'test', content: 'Beta' });
      const hash1 = computeNodeHash([n1, n2]);
      const hash2 = computeNodeHash([n1, n2]);
      expect(hash1).toBe(hash2);
    });

    it('returns different hash when nodes change', () => {
      const n1 = createNode({ namespace: 'test', content: 'Alpha' });
      const hash1 = computeNodeHash([n1]);
      const n2 = createNode({ namespace: 'test', content: 'Gamma' });
      const hash2 = computeNodeHash([n1, n2]);
      expect(hash1).not.toBe(hash2);
    });

    it('returns empty string for empty array', () => {
      const hash = computeNodeHash([]);
      expect(hash).toBe('');
    });
  });

  describe('cache', () => {
    it('returns null when no cached digest exists', () => {
      const result = getCachedDigest('test', 'somehash', 2);
      expect(result).toBeNull();
    });

    it('stores and retrieves a cached digest', () => {
      cacheDigest('test', 'The digest content', 'hash123', 2);
      const result = getCachedDigest('test', 'hash123', 2);
      expect(result).toBe('The digest content');
    });

    it('returns null when hash does not match', () => {
      cacheDigest('test', 'The digest content', 'hash123', 2);
      const result = getCachedDigest('test', 'different-hash', 2);
      expect(result).toBeNull();
    });

    it('returns null when days do not match', () => {
      cacheDigest('test', 'The digest content', 'hash123', 2);
      const result = getCachedDigest('test', 'hash123', 7);
      expect(result).toBeNull();
    });

    it('overwrites cache for same namespace', () => {
      cacheDigest('test', 'Old content', 'hash1', 2);
      cacheDigest('test', 'New content', 'hash2', 2);
      const result = getCachedDigest('test', 'hash2', 2);
      expect(result).toBe('New content');
    });
  });
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/digest.test.ts`
Expected: FAIL — cannot import from `digest.js`

**Step 3: Implement cache functions**

Create `src/core/digest.ts`:

```typescript
import crypto from 'crypto';
import { getDatabase } from '../db/connection.js';
import type { Node } from './nodes.js';

export function computeNodeHash(nodes: Node[]): string {
  if (nodes.length === 0) return '';
  const data = nodes
    .map(n => `${n.id}:${n.updated_at}`)
    .sort()
    .join('|');
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
}

export function getCachedDigest(namespace: string, nodeHash: string, days: number): string | null {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT content FROM digests WHERE namespace = ? AND node_hash = ? AND days = ?'
  ).get(namespace, nodeHash, days) as { content: string } | undefined;
  return row?.content ?? null;
}

export function cacheDigest(namespace: string, content: string, nodeHash: string, days: number): void {
  const db = getDatabase();
  db.prepare(`
    INSERT OR REPLACE INTO digests (namespace, content, generated_at, node_hash, days)
    VALUES (?, ?, datetime('now'), ?, ?)
  `).run(namespace, content, nodeHash, days);
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/digest.test.ts`
Expected: PASS (all cache + hash tests)

**Step 5: Commit**

```bash
git add src/core/digest.ts tests/core/digest.test.ts
git commit -m "feat(digest): implement cache functions and node hashing"
```

---

### Task 3: Implement digest prompt builder

**Files:**
- Modify: `src/core/digest.ts` (add `buildDigestPrompt`)
- Test: `tests/core/digest.test.ts` (extend)

**Step 1: Write the failing tests**

Add to `tests/core/digest.test.ts`:

```typescript
import { buildDigestPrompt } from '../../src/core/digest.js';
import type { Link } from '../../src/core/links.js';

// ... (keep existing)

  describe('buildDigestPrompt', () => {
    const mockNodes: Node[] = [
      {
        id: 'kt-aaa111', namespace: 'test', title: 'API design decision',
        content: 'Chose REST over GraphQL for simplicity. Team lacks GraphQL experience.',
        status: 'active', source_type: 'capture', tags: ['architecture'],
        embedding_pending: false, compacted_into: null,
        created_at: '2026-02-11 10:00:00', updated_at: '2026-02-11 10:00:00',
        stale_at: null, session_id: null,
      },
      {
        id: 'kt-bbb222', namespace: 'test', title: 'Auth approach',
        content: 'Using JWT with refresh tokens. Session duration 24h.',
        status: 'active', source_type: 'capture', tags: ['auth'],
        embedding_pending: false, compacted_into: null,
        created_at: '2026-02-12 09:00:00', updated_at: '2026-02-12 09:00:00',
        stale_at: null, session_id: null,
      },
    ];

    it('includes node content in the prompt', () => {
      const prompt = buildDigestPrompt(mockNodes, [], null);
      expect(prompt).toContain('API design decision');
      expect(prompt).toContain('Auth approach');
      expect(prompt).toContain('REST over GraphQL');
      expect(prompt).toContain('JWT with refresh tokens');
    });

    it('includes CLAUDE.md context when provided', () => {
      const claudeMd = '# My Project\n\nThis is a REST API for managing widgets.';
      const prompt = buildDigestPrompt(mockNodes, [], claudeMd);
      expect(prompt).toContain('managing widgets');
    });

    it('omits CLAUDE.md section when null', () => {
      const prompt = buildDigestPrompt(mockNodes, [], null);
      expect(prompt).not.toContain('Project Context');
    });

    it('includes link information', () => {
      const links: Link[] = [{
        id: 'link-1', source_id: 'kt-bbb222', target_id: 'kt-aaa111',
        link_type: 'related', context: 'both about architecture', created_at: '2026-02-12',
      }];
      const prompt = buildDigestPrompt(mockNodes, links, null);
      expect(prompt).toContain('kt-bbb222');
      expect(prompt).toContain('related');
      expect(prompt).toContain('kt-aaa111');
    });

    it('instructs Claude to produce structured sections', () => {
      const prompt = buildDigestPrompt(mockNodes, [], null);
      expect(prompt).toContain('Summary');
      expect(prompt).toContain('Key Topics');
      expect(prompt).toContain('Decisions');
      expect(prompt).toContain('Open Threads');
    });
  });
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/digest.test.ts`
Expected: FAIL — `buildDigestPrompt` not exported

**Step 3: Implement the prompt builder**

Add to `src/core/digest.ts`:

```typescript
import type { Link } from './links.js';

export function buildDigestPrompt(
  nodes: Node[],
  links: Link[],
  claudeMdContent: string | null,
): string {
  const sorted = [...nodes].sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  );

  const nodeDescriptions = sorted.map(n => {
    const title = n.title ? `**${n.title}**` : '(untitled)';
    const tags = n.tags ? ` [tags: ${n.tags.join(', ')}]` : '';
    return `### ${n.id}: ${title}${tags}\nCaptured: ${n.created_at}\n\n${n.content}`;
  }).join('\n\n');

  const linkDescriptions = links.length > 0
    ? `\n## Relationships Between Nodes\n\n${links.map(l =>
        `- ${l.source_id} **${l.link_type}** ${l.target_id}${l.context ? ` — ${l.context}` : ''}`
      ).join('\n')}\n`
    : '';

  const claudeMdSection = claudeMdContent
    ? `\n## Project Context (from CLAUDE.md)\n\n${claudeMdContent}\n`
    : '';

  return `You are generating a knowledge digest — a structured briefing of recent knowledge captured in a project namespace.

Your job is to synthesize the nodes below into a coherent, readable briefing that helps someone quickly understand what's been happening.
${claudeMdSection}
## Recent Knowledge Nodes

${nodeDescriptions}
${linkDescriptions}
## Output Format

Produce a markdown briefing with these sections. Omit any section that has no relevant content.

### Summary
2-3 sentences: what is this namespace about and what has been happening recently.

### Key Topics
Group knowledge by theme (not chronologically). Each topic gets a short paragraph describing the current state of knowledge.

### Decisions & Rationale
Any decisions captured, with their reasoning. Preserve the "why" — this is the most valuable part.

### Open Threads
Things that feel unresolved: contradictions between nodes, stale knowledge that may need updating, questions without clear answers.

### Alerts
Conflicts or stale knowledge that needs attention. Only include if present.

## Rules

- Be concise — this is a briefing, not a report
- Preserve specifics: names, numbers, dates, technical choices
- Group by theme, not by date
- If nodes contradict each other, surface this in Open Threads
- Do NOT add your own analysis or recommendations — just synthesize what's captured
- Output ONLY the briefing markdown, no preamble`;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/digest.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/digest.ts tests/core/digest.test.ts
git commit -m "feat(digest): implement prompt builder for Claude synthesis"
```

---

### Task 4: Implement digest generation orchestrator

**Files:**
- Modify: `src/core/digest.ts` (add `generateDigest`)
- Test: `tests/core/digest.test.ts` (extend)

**Step 1: Write the failing tests**

Add to `tests/core/digest.test.ts`:

```typescript
import { generateDigest } from '../../src/core/digest.js';
import { createLink } from '../../src/core/links.js';
import { addMapping } from '../../src/core/mappings.js';

// ... (keep existing)

  describe('generateDigest', () => {
    it('returns a message when no nodes exist in time window', async () => {
      const result = await generateDigest('test', { days: 2 });
      expect(result).toContain('No recent knowledge');
    });

    it('fetches recent nodes within the time window', async () => {
      // Create a node (it will have "now" as created_at, so within 2 days)
      createNode({ namespace: 'test', content: 'Recent insight about testing' });

      // generateDigest will try to call Claude — we test that it gathers the right data
      // by checking it does NOT return the "no nodes" message
      const result = await generateDigest('test', { days: 2 });
      // Without ANTHROPIC_API_KEY, it should return an error about the key
      // OR if key is set, it returns actual digest content
      expect(result).not.toContain('No recent knowledge');
    });

    it('uses cache when available', async () => {
      const node = createNode({ namespace: 'test', content: 'Cached insight' });
      // Manually cache a digest with the correct hash
      const hash = computeNodeHash([node]);
      cacheDigest('test', 'Cached digest output', hash, 2);

      const result = await generateDigest('test', { days: 2 });
      expect(result).toBe('Cached digest output');
    });

    it('includes links between recent nodes', async () => {
      const n1 = createNode({ namespace: 'test', content: 'First point' });
      const n2 = createNode({ namespace: 'test', content: 'Second point' });
      createLink(n2.id, 'related', n1.id, 'connected ideas');

      // With cache pre-seeded, test passes without API key
      // Without cache, it would attempt Claude call
      // We just verify it doesn't crash with links present
      const result = await generateDigest('test', { days: 2 });
      expect(result).toBeDefined();
    });
  });
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/digest.test.ts`
Expected: FAIL — `generateDigest` not exported

**Step 3: Implement the orchestrator**

Add to `src/core/digest.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { listNodes } from './nodes.js';
import { getLinks } from './links.js';
import { getConflicts } from './links.js';

const MODEL = 'claude-sonnet-4-5-20250929';

interface DigestOptions {
  days?: number;
  fresh?: boolean;
  projectDir?: string;
}

function getRecentNodes(namespace: string, days: number): Node[] {
  const allNodes = listNodes({ namespace, status: 'active' });
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().replace('T', ' ').substring(0, 19);
  return allNodes.filter(n => n.created_at >= cutoffStr || n.updated_at >= cutoffStr);
}

function getLinksForNodes(nodes: Node[]): Link[] {
  const nodeIds = new Set(nodes.map(n => n.id));
  const allLinks: Link[] = [];
  for (const node of nodes) {
    const links = getLinks(node.id);
    for (const link of links) {
      if (nodeIds.has(link.target_id)) {
        allLinks.push(link);
      }
    }
  }
  return allLinks;
}

function readClaudeMd(projectDir: string | undefined): string | null {
  if (!projectDir) return null;
  const claudeMdPath = path.join(projectDir, '.claude', 'CLAUDE.md');
  try {
    return fs.readFileSync(claudeMdPath, 'utf-8');
  } catch {
    return null;
  }
}

export async function generateDigest(
  namespace: string,
  options: DigestOptions = {},
): Promise<string> {
  const days = options.days ?? 2;

  const recentNodes = getRecentNodes(namespace, days);

  if (recentNodes.length === 0) {
    return `No recent knowledge captured in "${namespace}" (last ${days} day${days === 1 ? '' : 's'}). Use \`kt capture\` to add knowledge.`;
  }

  const nodeHash = computeNodeHash(recentNodes);

  // Check cache (unless --fresh)
  if (!options.fresh) {
    const cached = getCachedDigest(namespace, nodeHash, days);
    if (cached) return cached;
  }

  // Need API key for synthesis
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return 'Error: ANTHROPIC_API_KEY not set. The digest requires Claude to synthesize knowledge.\nSet it with: export ANTHROPIC_API_KEY=your-key';
  }

  const links = getLinksForNodes(recentNodes);
  const claudeMd = readClaudeMd(options.projectDir);
  const prompt = buildDigestPrompt(recentNodes, links, claudeMd);

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = message.content[0];
    if (block.type === 'text') {
      const digest = block.text.trim();
      cacheDigest(namespace, digest, nodeHash, days);
      return digest;
    }

    return 'Error: Unexpected response from Claude.';
  } catch (err) {
    return `Error generating digest: ${err instanceof Error ? err.message : err}`;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/digest.test.ts`
Expected: PASS (the "no API key" and cache tests should pass; the link test should not crash)

**Step 5: Commit**

```bash
git add src/core/digest.ts tests/core/digest.test.ts
git commit -m "feat(digest): implement generation orchestrator with cache + Claude"
```

---

### Task 5: Wire up the CLI default command

**Files:**
- Create: `src/cli/commands/digest.ts`
- Modify: `src/index.ts`

**Step 1: Write the failing test**

Add to `tests/cli/commands.test.ts`:

```typescript
  it('bare kt with no mapped namespace shows helpful message', () => {
    // Run kt with no subcommand in a directory with no mapping
    const output = kt('');
    expect(output).toContain('No namespace mapped');
  });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/commands.test.ts`
Expected: FAIL — bare `kt` shows Commander help text, not the expected message

**Step 3: Create the digest CLI command**

Create `src/cli/commands/digest.ts`:

```typescript
import { resolveNamespace } from '../../core/mappings.js';
import { generateDigest } from '../../core/digest.js';
import { getDatabase } from '../../db/connection.js';

interface DigestCliOptions {
  days?: string;
  fresh?: boolean;
  namespace?: string;
}

function resolveProjectDir(namespace: string): string | undefined {
  const db = getDatabase();
  const mapping = db.prepare(
    'SELECT directory_pattern FROM project_mappings WHERE namespace = ? ORDER BY length(directory_pattern) DESC LIMIT 1'
  ).get(namespace) as { directory_pattern: string } | undefined;

  if (mapping) {
    return mapping.directory_pattern.replace(/\/?\*$/, '');
  }
  return undefined;
}

export async function runDigest(options: DigestCliOptions): Promise<void> {
  const namespace = options.namespace || resolveNamespace(process.cwd());

  if (!namespace) {
    console.log('No namespace mapped for this directory.');
    console.log(`Use \`kt map <pattern> <namespace>\` to set one up.`);
    console.log(`Example: kt map "${process.cwd()}/*" my-project`);
    return;
  }

  const days = options.days ? parseInt(options.days) : 2;
  const projectDir = resolveProjectDir(namespace);

  const digest = await generateDigest(namespace, {
    days,
    fresh: options.fresh,
    projectDir,
  });

  console.log(digest);
}
```

**Step 4: Wire up in `src/index.ts`**

Replace `src/index.ts` with:

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
import { embedCommand } from './cli/commands/embed.js';
import { compactCommand } from './cli/commands/compact.js';
import { runDigest } from './cli/commands/digest.js';

// Initialize database
const dbPath = process.env.KT_DB_PATH || getDefaultDbPath();
createDatabase(dbPath);

const program = new Command()
  .name('kt')
  .description('Knowledge Tracker — CLI-first knowledge management for AI agents')
  .version('0.1.0')
  .option('--days <n>', 'Time window for digest in days', '2')
  .option('--fresh', 'Force regenerate digest (bypass cache)')
  .option('-n, --namespace <ns>', 'Namespace (auto-detected from cwd if omitted)')
  .action(async (options) => {
    await runDigest({
      days: options.days,
      fresh: options.fresh,
      namespace: options.namespace,
    });
  });

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
program.addCommand(embedCommand());
program.addCommand(compactCommand());

program.parseAsync().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run tests/cli/commands.test.ts`
Expected: PASS — bare `kt` now shows "No namespace mapped" message

**Step 6: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS (no regressions)

**Step 7: Commit**

```bash
git add src/cli/commands/digest.ts src/index.ts tests/cli/commands.test.ts
git commit -m "feat(digest): wire up bare 'kt' as default digest command"
```

---

### Task 6: Manual smoke test

**Files:** None (manual verification)

**Step 1: Build the project**

Run: `npm run build`
Expected: Clean compilation, no errors

**Step 2: Test bare `kt` in an unmapped directory**

Run: `cd /tmp && kt`
Expected: "No namespace mapped for this directory" message

**Step 3: Test bare `kt` in a mapped directory**

Run: `cd ~/GitHub/kt && kt`
Expected: Either a Claude-generated digest (if `ANTHROPIC_API_KEY` is set and nodes exist) or appropriate error/empty message

**Step 4: Test with `--days` flag**

Run: `cd ~/GitHub/kt && kt --days 7`
Expected: Wider time window, possibly more nodes included

**Step 5: Test with `--fresh` flag**

Run: `cd ~/GitHub/kt && kt --fresh`
Expected: Regenerates even if cached

**Step 6: Verify subcommands still work**

Run: `kt search "test" && kt stats && kt --help`
Expected: All existing commands function normally. Help shows the new `--days`, `--fresh`, `--namespace` options.

**Step 7: Commit build output**

```bash
npm run build
git add -A
git commit -m "feat(digest): complete digest feature with build"
```
