# Knowledge Tracker (kt) — Design Document

## Problem

AI coding agents lose context between sessions. Knowledge accumulated in one conversation — decisions, client context, strategic insights — disappears when the session ends. Current workarounds (CLAUDE.md notes, log files, manual documentation) are fragile, unstructured, and don't scale.

Third-party memory tools (Mem0, memory-mcp) solve parts of this but route your data through external infrastructure — unacceptable for a consultant handling client strategy.

## Solution

A CLI-first, local-only knowledge management system designed for AI agents. Inspired by Beads' architecture (structured, agent-optimized) but applied to knowledge instead of tasks. Knowledge nodes have lifecycle, relationships drive behavior, and old knowledge gets compacted rather than accumulated indefinitely.

## Design Principles

- **CLI-first, service-optional** — All operations work via command line. Ollama provides embeddings but isn't in the critical path.
- **Local-only, privacy-first** — All data stays on your machine. No external services touch your knowledge.
- **Freeform content, structured lifecycle** — No rigid taxonomy. Content is whatever you write. The system manages status, relationships, and staleness.
- **Links drive behavior** — A `supersedes` link marks the old node stale. A `contradicts` link surfaces a conflict. Links aren't decorative.
- **Explicit capture, automated structure** — You decide when to save. The system decides how to structure, link, and embed it.
- **Graceful degradation** — Without Ollama: capture, read, update, link all work. Only semantic search is degraded.

## Architecture

```
┌─────────────────────────────────┐
│           CLI (kt)              │  User/agent interface
├─────────────────────────────────┤
│         Core Library            │  Business logic, lifecycle management
├──────────────┬──────────────────┤
│  SQLite +    │  Ollama          │  Storage + vector search │ Embeddings
│  sqlite-vec  │  (optional)      │  Local, zero-cost
└──────────────┴──────────────────┘

Central store: ~/.kt/
Project overrides: .kt/config
```

### Components

**CLI (`kt`)** — The primary interface. Agents call it via bash, humans can use it directly.

**Core Library** — Handles CRUD, lifecycle transitions, link-driven behavior, compaction logic.

**SQLite + sqlite-vec** — Single-file database. Stores nodes, links, embeddings. No server, no setup, portable.

**Ollama** — Runs `nomic-embed-text` (768 dimensions) for embedding generation. Called on capture and compaction. If unavailable, embeddings are queued and generated on next availability.

## Data Model

### Knowledge Node

```sql
CREATE TABLE nodes (
  id                TEXT PRIMARY KEY,     -- hash-based (like Beads: kt-a1b2)
  namespace         TEXT NOT NULL,        -- project/topic grouping
  title             TEXT,                 -- optional, can be auto-generated
  content           TEXT NOT NULL,        -- freeform markdown
  status            TEXT NOT NULL DEFAULT 'active',  -- active|stale|compacted
  source_type       TEXT NOT NULL,        -- capture|compaction
  tags              TEXT,                 -- JSON array, emergent (not from a fixed set)
  embedding         BLOB,                -- 768-dim vector (nullable if Ollama unavailable)
  embedding_pending BOOLEAN DEFAULT FALSE,
  compacted_into    TEXT,                -- points to summary node ID
  created_at        DATETIME NOT NULL,
  updated_at        DATETIME NOT NULL,
  stale_at          DATETIME,            -- when staleness was detected
  session_id        TEXT                 -- which session captured this
);
```

### Links

```sql
CREATE TABLE links (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL REFERENCES nodes(id),
  target_id   TEXT NOT NULL REFERENCES nodes(id),
  link_type   TEXT NOT NULL,  -- supersedes|contradicts|related
  context     TEXT,           -- why this link exists
  created_at  DATETIME NOT NULL
);
```

Link behavior:
- **`supersedes`** — Source replaces target. Target gets marked `stale` automatically.
- **`contradicts`** — Conflict. Surfaced in context loading. Neither auto-stales — requires resolution.
- **`related`** — Informational connection. Used for cluster detection in compaction.

### Namespaces

```sql
CREATE TABLE namespaces (
  slug             TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT
);
```

Global staleness threshold (default: 60 days) configured in `~/.kt/config.json`. Override per namespace only when needed.

### Project Mappings

```sql
CREATE TABLE project_mappings (
  directory_pattern  TEXT PRIMARY KEY,  -- glob: ~/GitHub/client-x/*
  namespace          TEXT NOT NULL
);
```

### Status Transitions

```
active ──→ stale ──→ compacted
  │         │
  │         └──→ (deleted)
  └──────────→ (deleted)
```

**Automatic transitions:**
- `active → stale`: When superseded, or age exceeds staleness threshold
- `stale → compacted`: When compaction pipeline runs and node is part of a cluster

**Manual transitions:**
- `stale → active`: User overrides staleness ("this is still relevant")
- Any status → deleted: User decision (hard delete, node is gone)

## CLI Interface

### Core Commands

```bash
# Capture knowledge
kt capture "Client X rejected sprint format — too disruptive to quarterly planning"
kt capture --namespace clients --file notes.md

# Search
kt search "what do we know about client X's planning cycle"
kt search --namespace ep-advisory

# Read
kt show kt-a1b2
kt show kt-a1b2 --with-links

# Context loading (primary use for agents)
kt context                          # auto-detect namespace from cwd
kt context --namespace ep-advisory  # explicit
kt context --limit 5                # top N nodes

# Lifecycle management
kt status kt-a1b2 active           # override staleness
kt delete kt-a1b2                  # remove a node

# Linking
kt link kt-a1b2 supersedes kt-c3d4
kt link kt-a1b2 contradicts kt-e5f6 --context "different conclusion from same data"
kt link kt-a1b2 related kt-g7h8

# Compaction
kt compact --namespace clients --dry-run     # preview what would be compacted
kt compact --namespace clients               # compact (auto, no approval flow)

# Namespace management
kt ns create clients
kt ns list

# Project mapping
kt map "~/GitHub/ep-advisory/*" ep-advisory
kt map "~/GitHub/client-x/*" clients

# Maintenance
kt stale                    # list all stale nodes
kt embed                    # generate pending embeddings now
kt stats                    # node counts by status, namespace, age
```

### Output Modes

```bash
kt search "pricing" --format json    # structured output for agents
kt search "pricing" --format human   # readable output for humans
kt search "pricing" --format brief   # title + status + one-line summary
```

Default: `json` when stdout is not a TTY (agent context), `human` when it is.

## Context Loading

### Auto-load (Session Start)

A Claude Code session-start hook:

1. Detects current working directory
2. Checks `project_mappings` for a matching directory pattern
3. If match: runs `kt context --namespace <matched> --format json`
4. If no match: runs `kt context --recent --limit 3` (most recent active nodes across all namespaces)
5. Injects result into session context

**Hook implementation:**
```bash
#!/bin/bash
# ~/.claude/hooks/session-start-kt.sh
KT_CONTEXT=$(kt context --format json 2>/dev/null)
if [ -n "$KT_CONTEXT" ]; then
  echo "$KT_CONTEXT"
fi
```

### Context Brief Format

What `kt context` returns:

```json
{
  "namespace": "ep-advisory",
  "loaded_at": "2026-02-10T14:30:00Z",
  "active_nodes": [
    {
      "id": "kt-a1b2",
      "title": "EP Advisory pricing decision",
      "summary": "Three-tier model: embedded advisory (retainer), salon (community), sprints (project)",
      "updated_at": "2026-02-08",
      "links_out": 3
    }
  ],
  "conflicts": [
    {
      "node_a": "kt-c3d4",
      "node_b": "kt-e5f6",
      "description": "Contradicting views on sprint pricing"
    }
  ],
  "stale_alerts": [
    {
      "id": "kt-g7h8",
      "title": "Client pipeline Q1",
      "stale_since": "2026-01-28",
      "reason": "age (43 days)"
    }
  ]
}
```

### Ambient Lookups (Mid-conversation)

CLAUDE.md instruction:

```markdown
## Knowledge System

You have access to `kt` (knowledge tracker). Use it:
- At session start: context is auto-loaded via hook
- During conversation: when you encounter a client name, strategic concept,
  or domain you may have prior knowledge about, run `kt search "<topic>"`
  before proceeding. Surface findings briefly, don't dump.
- After meaningful work: suggest `/capture` if decisions were made or
  insights emerged worth persisting.
```

## Capture Flow

### What Happens When You Run `kt capture`

```
User/Agent: kt capture "Client X rejected sprint format"

1. Parse content
2. Auto-detect metadata:
   - namespace: from cwd mapping, or prompt
   - tags: extracted by lightweight heuristic (client names, topics)
   - source_type: "capture"
3. Check for similar existing nodes:
   - If Ollama available: semantic similarity check
   - If not: keyword/tag overlap check
4. If similar nodes found:
   - Output: "Similar knowledge exists: kt-a1b2 'Client X prefers quarterly planning'"
   - Suggest: extend, update, or keep both
5. If no conflicts:
   - Create node with hash ID
   - Generate embedding (or queue if Ollama unavailable)
   - Auto-link to semantically similar nodes
   - Output: "Captured as kt-f9g0 in namespace 'clients'"
```

### `/capture` Skill (Claude Code)

```
User: /capture

Claude: What's worth saving from this session?
- Decisions made
- Client context learned
- Insights or patterns noticed

User: We decided to position the salon as invitation-only,
      not application-based. Isa suggested it, reasoning that
      exclusivity signals confidence.

Claude: [runs kt capture with structured content]
        Captured as kt-h1i2 in 'ep-advisory'
        Linked to: kt-j3k4 "Salon service model" (related)

        Anything else from this session?
```

## Compaction Pipeline

### Three Passes

**Pass 1 — Staleness Detection** (runs on schedule or manual trigger)

```
For each active node:
  - Has a 'supersedes' inbound link? → mark stale
  - Has unresolved 'contradicts' link? → flag conflict (don't auto-stale)
  - Age > staleness threshold? → mark stale
  - Zero inbound links + age > 30 days? → mark stale
```

**Pass 2 — Cluster Detection**

```
For stale nodes:
  - Group by: shared links (related forming subgraphs)
  - Group by: semantic similarity (> 0.8 cosine) within same namespace
  - Minimum cluster size: 3 nodes
  - Output: list of clusters with member nodes
```

**Pass 3 — Compaction**

```
For each cluster:
  - Feed all member node content to Claude
  - Prompt: "Summarize the essential knowledge from these nodes into a
    single concise node. Preserve decisions, rationale, and current state.
    Drop outdated details."
  - Create summary node (status: active, source_type: compaction)
  - Re-point inbound links from member nodes to summary
  - Mark member nodes as compacted (compacted_into → summary ID)
  - Preserve originals (never deleted)
```

`kt compact --dry-run` previews what would happen. Without `--dry-run`, compaction executes directly. No interactive approval flow — trust the algorithm, review with dry-run when you want visibility.

## Implementation Phases

### Phase 1 — Foundation (Knowledge Node Model + CLI skeleton)

Deliverables:
- SQLite schema with sqlite-vec
- Core library: CRUD operations, status transitions, link management
- CLI commands: `capture`, `show`, `search` (keyword-only), `link`, `status`, `ns`, `map`
- Hash-based ID generation
- JSON + human output modes
- `~/.kt/` directory structure and config

What you get: A working knowledge store you can capture to and query from.

### Phase 2 — Capture Intelligence

Deliverables:
- Ollama integration for embedding generation
- Semantic similarity search via sqlite-vec
- Duplicate/similar node detection on capture
- Auto-linking based on semantic similarity
- `/capture` Claude Code skill
- Pending embedding queue + `kt embed` command

What you get: Smart capture with dedup and semantic search.

### Phase 3 — Context Loading

Deliverables:
- `kt context` command with structured brief output
- Project-to-namespace mapping (`kt map`)
- Session-start hook for Claude Code
- CLAUDE.md ambient lookup instructions

What you get: Sessions start with relevant knowledge automatically.

### Phase 4 — Compaction

Deliverables:
- Staleness detection (link-driven + age-based)
- Cluster detection (graph + semantic)
- Claude-powered summarization
- `kt compact` and `kt stale` commands
- `/compact` Claude Code skill

What you get: Knowledge stays clean over time without manual curation.

## Language Decision

**Recommendation: TypeScript for Phase 1-2, evaluate Go port later.** The AI wiki's services (embeddings, search) provide reusable patterns. Ship faster, validate the design with real usage, then consider a Go rewrite if single-binary distribution matters.

## Open Questions

1. **MCP bridge** — Should we also expose `kt` as an MCP server for environments where bash isn't available? Defer until needed.
2. **Sync across machines** — `~/.kt/` is local. For Mac Mini ↔ MacBook Air sync, options include rsync, shared network path, or eventually running `kt` as a service on Mac Mini. Defer until local-first is validated.
3. **Relationship to AI wiki** — Fork the wiki, strip what we need (embedding logic, similarity search), build kt on top. The wiki's web layer, multi-tenancy, and Vercel deployment get dropped.
4. **Embedding model** — Starting with `nomic-embed-text` (768d). If sqlite-vec performance is an issue at scale, evaluate smaller models or dimensionality reduction.

## What This Replaces

| Before | After |
|---|---|
| CLAUDE.md task notes | `kt capture` + `kt context` |
| `_log.md` activity trails | `kt` with lifecycle tracking |
| Hoping you remember context | Auto-loaded on session start |
| Knowledge accumulates forever | Compaction pipeline |
| Flat text files | Structured graph with semantic search |
| Third-party memory services | Local-only, privacy-first |

## What This Doesn't Replace

| Stays the same | Why |
|---|---|
| CLAUDE.md instructions | Conventions, voice, workflow rules aren't knowledge nodes |
| README.md navigation | Folder orientation is structural, not knowledge |
| `/eplog` for human activity | Human-readable logs serve a different audience |
| Project-specific CLAUDE.md | Agent behavior config stays where it is |
