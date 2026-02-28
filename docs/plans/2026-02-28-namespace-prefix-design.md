# Multi-Instance kt with Hierarchical Namespaces — Design

**Date:** 2026-02-28
**Status:** Approved (revised)

## Problem

kt uses a single global database (`~/.kt/kt.db`) with flat namespaces. This creates two problems:

1. **No isolation between contexts.** Personal knowledge, client work, and partner-shared knowledge all live in one database. There's no natural way to give a business partner access to only the shared work.

2. **No hierarchical scoping.** Every query filters with `namespace = ?` exact matching. You can't zoom between "everything for this client" and "just this workstream."

## Solution: Two Changes

### 1. Multi-instance: one `.kt/` per vault

kt databases become local to a directory tree, like `.git/`. Drop a `.kt/` directory in a vault root (e.g., your Obsidian vault), and all kt operations within that tree use that database.

```
explicit-protocol/              ← vault root
  .kt/
    kt.db                      ← EP-only database
  ep/
    strategy/
    research/
  clients/
    google/
      workshop/
    hpi/

~/GitHub/personal-project/
  .kt/
    kt.db                      ← personal database

~/.kt/
  kt.db                        ← fallback global (existing behavior)
```

**Resolution:** Walk up from cwd looking for `.kt/kt.db`. Fall back to `~/.kt/kt.db`. Same pattern as git.

**Partner access:** MCP server points at `explicit-protocol/.kt/kt.db`. Complete isolation — partner sees only EP knowledge.

### 2. Hierarchical namespaces within each instance

Within a vault, namespaces auto-derive from folder structure. No manual mappings needed.

**Behavioral principle: depth-inclusive, never upward.** A namespace always includes its children, never its parents. This matches how attention scopes during work.

```
You're in:                              Resolved namespace:
explicit-protocol/                   →  (all — vault root)
explicit-protocol/clients/           →  clients
explicit-protocol/clients/google/    →  clients.google
explicit-protocol/clients/google/q1/ →  clients.google  (capped at 3 levels)
```

Searching from `clients/` includes `clients`, `clients.google`, `clients.hpi`, etc.
Searching from `clients/google/` includes only `clients.google` and its children.
Never upward.

## Design Decisions

### Database resolution (new)

New function `resolveDatabase()`:
1. Walk up from cwd checking for `.kt/kt.db` at each level
2. If found, return that path. The directory containing `.kt/` is the "vault root."
3. If not found, fall back to `~/.kt/kt.db` (current behavior)

The existing `KT_DB_PATH` env var overrides everything (used by tests and MCP server).

### Auto-derive namespaces from folder depth (revised)

`resolveNamespace()` no longer needs `project_mappings` for vault-local instances. Instead:

1. Find the vault root (the directory containing `.kt/`)
2. Compute the relative path from vault root to cwd
3. Convert path segments to dot-separated namespace, capped at 3 levels

```
Vault root: /path/to/explicit-protocol/
Cwd:        /path/to/explicit-protocol/clients/google/workshop/

Relative:   clients/google/workshop
Segments:   ['clients', 'google', 'workshop']
Capped:     ['clients', 'google']  (3 levels = 3 segments max)
Namespace:  clients.google
```

For the fallback global database (`~/.kt/kt.db`), `project_mappings` still works as before — it's the only way to resolve namespaces without a vault root.

### Prefix matching via SQL LIKE

Every `namespace = ?` query becomes:

```typescript
function namespaceFilter(ns: string): { sql: string; params: string[] } {
  return {
    sql: '(namespace = ? OR namespace LIKE ?)',
    params: [ns, `${ns}.%`],
  };
}
```

The dot boundary in `${ns}.%` prevents false matches (`clients.go` won't match `clients.google`).

~15 query locations across core modules, CLI commands, and MCP tools need this change.

### Depth cap at 3 levels

Namespace segments capped at 3 levels from vault root. Deeper subfolders roll up:

```
Level 0:  explicit-protocol/              → (vault root, all namespaces)
Level 1:  clients/                        → clients
Level 2:  clients/google/                 → clients.google
Level 3:  clients/google/workshop/        → clients.google.workshop
Level 4+: clients/google/workshop/day-1/  → clients.google.workshop (capped)
```

### Auto-create parent namespace rows

When `ensureNamespace('clients.google.workshop')` runs, it also creates `clients` and `clients.google`. Each gets a name derived from its last segment. All via `INSERT OR IGNORE`.

### kt init

New command: `kt init` — creates `.kt/` directory and empty database in cwd. Like `git init`.

## What Changes

### New: Database resolution layer

| Component | Change |
|---|---|
| `src/db/connection.ts` | `resolveDatabase()` — walk-up logic for `.kt/kt.db` |
| `src/db/connection.ts` | `getDatabase()` — use resolved path instead of hardcoded `~/.kt/kt.db` |
| CLI | New `kt init` command |

### New: Vault-aware namespace resolution

| Component | Change |
|---|---|
| `src/core/mappings.ts` | `resolveNamespace()` — vault-local: derive from relative path. Global: existing `project_mappings` logic. |

### Modified: Prefix matching (~15 query locations)

| File | Function | Notes |
|---|---|---|
| `src/core/nodes.ts` | `listNodes()` | Used by context, stale listing |
| `src/core/search.ts` | `searchNodes()` | Keyword search |
| `src/core/search.ts` | `semanticSearch()` | Vector post-filter |
| `src/core/staleness.ts` | `detectStaleNodes()` | Two queries (primary + orphan) |
| `src/core/links.ts` | `getConflicts()` | Join condition on n1.namespace |
| `src/core/clustering.ts` | `detectClusters()` | Stale node grouping |
| `src/cli/commands/stats.ts` | `statsCommand()` | 7 count queries via shared nsFilter + GROUP BY |
| `src/cli/commands/context.ts` | count query | Bypasses listNodes() |
| `src/mcp/tools.ts` | `handleContext()` | 3 raw SQL queries |

### Modified: Auto-create parents

| Component | Change |
|---|---|
| `src/core/namespaces.ts` | `ensureNamespace()` — split on dots, create ancestors |

### No changes needed

- Namespace CRUD (`ns create`, `ns list`, `ns delete`) — operate on exact slugs
- Capture — assigns to one specific namespace (the resolved one)
- Digest cache — keyed by exact namespace
- Schema — no migration

## Backward Compatibility

- **Existing `~/.kt/kt.db`** — stays as the global fallback. Everything in it keeps working.
- **Existing `project_mappings`** — still used for the global database. Vault-local instances don't need them.
- **Existing flat namespaces** — prefix filter degenerates to exact match when there are no children. No migration needed.
- **`KT_DB_PATH` env var** — still overrides everything (tests, MCP server).

## Context

This design was informed by:
- Analysis of Memory Engine (memory.build) which uses PostgreSQL ltree for dot-notation hierarchy
- Technical analysis of ANN index limitations confirming single-collection + metadata filtering is correct
- Behavioral analysis: humans interact with work data through ambient awareness (zoom level), triggered recall (links), and directed lookup (search). Multi-instance serves isolation. Namespace hierarchy serves ambient awareness.
