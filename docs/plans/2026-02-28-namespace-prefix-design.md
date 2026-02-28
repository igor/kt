# Namespace Prefix Matching — Design

**Date:** 2026-02-28
**Status:** Approved

## Problem

kt uses flat namespaces with exact matching. Every query filters with `namespace = ?`. This means there's no way to scope knowledge hierarchically — you can't ask "show me everything under this client" or zoom between workstream-level and project-level context.

The primary use case is an Obsidian vault (`explicit protocol/`) with nested folders for clients and workstreams. When working in `clients/google/`, context and search should include all knowledge captured in google and its sub-workstreams. When working at the vault root, it should include everything.

## Behavioral Principle

**Depth-inclusive, never upward.** A namespace always includes its children, never its parents. This matches how human attention scopes during work — you zoom in to narrow focus, zoom out to widen it, but you never accidentally pull in sibling or parent context.

```
Resolved: ep           → sees ep, ep.clients, ep.clients.google, ...
Resolved: ep.clients   → sees ep.clients, ep.clients.google, ep.clients.hpi
Resolved: ep.clients.google → sees only ep.clients.google (and any children)
```

## Design Decisions

### 1. Prefix matching via SQL LIKE (not parent-child hierarchy)

Namespaces remain flat strings in the database. Dots are a naming convention, not enforced structure. No schema changes, no migration.

The filter helper:

```typescript
function namespaceFilter(ns: string): { sql: string; params: string[] } {
  return {
    sql: '(namespace = ? OR namespace LIKE ?)',
    params: [ns, `${ns}.%`],
  };
}
```

This matches the exact namespace AND anything starting with it followed by a dot. Using `${ns}.%` (not `${ns}%`) prevents false matches like `ep.acme-corp` when filtering for `ep.acme`.

**Why not recursive CTE with parent column:** Over-engineered for the scale (~hundreds of nodes). The prefix LIKE query is simpler, faster, requires no schema change, and produces identical results. SQLite's B-tree index on `namespace` supports prefix LIKE efficiently.

**Why not tags:** Tags solve cross-cutting queries ("all brand strategy across clients") but don't solve hierarchical scoping. They're a complementary feature, not a replacement. Tags may be added later.

### 2. Auto-derive namespaces from folder depth

`resolveNamespace()` changes from "look up exact mapping" to "find nearest root mapping, then derive dot segments from the relative path."

Today: longest-prefix directory match → return exact slug.

After: longest-prefix directory match → compute relative path → convert to dot segments → append to mapped slug.

Example with one root mapping (`explicit protocol/ → ep`):

```
Current directory                         Resolved namespace
explicit protocol/                     →  ep
explicit protocol/ep/                  →  ep.ep
explicit protocol/clients/             →  ep.clients
explicit protocol/clients/google/      →  ep.clients.google
explicit protocol/clients/google/q1/   →  ep.clients.google  (capped)
```

No per-subfolder mappings needed. One root mapping covers the entire vault.

### 3. Depth cap at 3 levels

Namespace segments are capped at 3 levels below the root mapping. Deeper subfolders roll up to the nearest capped ancestor. This prevents over-granular namespaces from deep Obsidian folder hierarchies.

```
Root mapping:  explicit protocol/ → ep        (level 0)
Level 1:       clients/           → ep.clients
Level 2:       clients/google/    → ep.clients.google
Level 3+:      clients/google/q1/ → ep.clients.google  (capped)
```

### 4. Auto-create parent namespace rows

When `ensureNamespace('ep.clients.google')` runs, it also creates `ep` and `ep.clients` if they don't exist. Each parent gets a generated name from its last dot segment. All via `INSERT OR IGNORE` — idempotent and fast.

This keeps `kt ns list` coherent. No orphaned children.

## What Changes

### Core namespace filter (~15 query locations)

Every `namespace = ?` becomes the prefix filter. Affected locations:

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

### resolveNamespace() — `src/core/mappings.ts`

Add relative-path-to-dots derivation with 3-level cap.

### ensureNamespace() — `src/core/namespaces.ts`

Split on dots, create all ancestor prefixes.

### No changes needed

- Namespace CRUD (`ns create`, `ns list`, `ns delete`) — operate on exact slugs
- Capture — assigns to one specific namespace (the resolved one)
- Digest cache — keyed by exact namespace (digest for `ep.acme` is different from `ep`)
- Schema — no migration

## Backward Compatibility

Existing flat namespaces (no dots) work identically. A namespace with no dots has no children, so the prefix filter degenerates to exact match. No migration, no data changes.

## Context

This design was informed by:
- Analysis of Memory Engine (memory.build) which uses PostgreSQL ltree for the same dot-notation pattern
- Technical analysis of ANN index limitations confirming that single-collection + metadata filtering (kt's approach) is correct for hierarchical scoping
- Behavioral analysis: humans interact with work data through ambient awareness (zoom level), triggered recall (links), and directed lookup (search). Namespace hierarchy serves the ambient awareness mode.
