# kt Digest — Design Document

## Problem

kt has solid knowledge capture but weak knowledge surfacing. The read-back experience is raw retrieval (`search`, `show`, `context`) with no synthesis. Users want to open a project folder, type `kt`, and get a coherent briefing.

## Solution

A Claude-synthesized digest that becomes the default `kt` command (no subcommand). Auto-resolves namespace from cwd, fetches recent nodes, reads project CLAUDE.md for context, and produces a structured narrative briefing.

## Audience

Dual-purpose: human-readable briefing and AI agent-consumable context.

## Data Flow

```
kt (no args)
  → resolve namespace from cwd (project_mappings)
  → check digests cache table
    → [cache valid + no new nodes] → print cached digest
    → [cache miss or stale]       → gather inputs → Claude → cache + print
```

### Inputs to Claude

1. **Recent nodes** — active nodes from last N days (default 2), full content with titles, dates, tags
2. **Project CLAUDE.md** — `<directory_pattern>/.claude/CLAUDE.md` if it exists (project context only, not user global)
3. **Links** — relationships between recent nodes (supersedes/contradicts/related)
4. **Stale/conflict alerts** — flagged for the digest to mention

## Cache Strategy

### New `digests` table

```sql
CREATE TABLE IF NOT EXISTS digests (
  namespace    TEXT PRIMARY KEY,
  content      TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  node_hash    TEXT NOT NULL,
  days         INTEGER NOT NULL
);
```

### Invalidation logic

- Query recent nodes for namespace + time window
- Compute hash from node IDs + `updated_at` timestamps
- Stored `node_hash` matches AND `days` matches → serve cached
- Otherwise → regenerate, overwrite cache
- `--fresh` flag bypasses cache entirely

One row per namespace. No cleanup needed.

## Output Format

Markdown to terminal. Sections scale to content — empty sections are omitted.

### Sections

- **Summary** — 2-3 sentence overview
- **Key Topics** — grouped by theme (not chronological), each with current state
- **Decisions & Rationale** — captured decisions with reasoning preserved
- **Open Threads** — unresolved items: contradictions, stale knowledge, unanswered questions
- **Alerts** — conflicts or stale nodes needing attention (only if present)

## CLI Interface

### Invocation

Bare `kt` triggers the digest. All existing subcommands unchanged.

### Flags

- `--days <n>` — time window (default: 2)
- `--fresh` — force regeneration
- `--namespace <ns>` — override auto-resolution

### Error cases

- No namespace mapping for cwd → helpful message pointing to `kt map`
- No ANTHROPIC_API_KEY → error with setup instructions
- No nodes in time window → "No recent knowledge captured" message

## CLAUDE.md Resolution

Uses the `directory_pattern` from `project_mappings` to find `<directory_pattern>/.claude/CLAUDE.md`. This is the project-level context (checked into repo). The user's global `~/.claude/CLAUDE.md` is NOT included — digest should be grounded in project-specific context.

If no CLAUDE.md found, digest proceeds without it.

## New Files

- `src/core/digest.ts` — core module (fetch, prompt, Claude call, cache)
- `src/cli/commands/digest.ts` — CLI wiring (thin, delegates to core)

## Modified Files

- `src/db/schema.sql` — add digests table
- `src/index.ts` — wire up default action (bare `kt` → digest)
