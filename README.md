# kt — Knowledge Tracker

CLI-first knowledge management for AI agents. Capture insights, build context, and let your knowledge base clean itself over time.

## ⚠️ Disclaimer

**This is an experimental exploration project.** Use at your own risk. It:
- Was built to understand local knowledge management patterns
- Has not been battle-tested in production
- May have bugs, edge cases, or data integrity issues
- Could modify or delete your knowledge nodes during compaction
- Is provided as-is with no guarantees or warranties

**Back up your database before using compaction features.**

## Why?

This started as an exploration to build something that combines ideas from:
- **[ai-wiki](https://github.com/dbmcco/ai-wiki)** — Knowledge wiki with semantic search that I've been using
- **[Beads](https://github.com/steveyegge/beads)** — Knowledge management designed for programmers
- But **fully local** — SQLite + Ollama, no cloud dependencies (except optional Claude API for compaction)

The goal was to understand how to make a self-maintaining knowledge system that works seamlessly with AI agents in the terminal.

## Features

- **Digest:** Type `kt` and get a synthesized briefing of recent knowledge — not a list of nodes, a coherent summary grouped by theme ([design notes](docs/design-digest-interaction.md))
- **Capture & Link:** Save knowledge nodes with automatic relationship detection
- **Semantic Search:** Vector-based similarity search via Ollama embeddings
- **Smart Context:** Auto-loaded session context for AI agents
- **Auto-Compaction:** Stale knowledge clusters are summarized via Claude API
- **Namespaces:** Organize knowledge by project or domain
- **Local-First:** SQLite + sqlite-vec, no external database needed

## Install

```bash
git clone https://github.com/igor/kt.git
cd kt
npm install
npm run build
npm link
```

## Quick Start

```bash
# Create a namespace and map your project directory
kt ns create my-project --name "My Project"
kt map "/path/to/my-project/*" my-project

# Capture knowledge
kt capture "We decided on two-tier pricing: pro and enterprise" \
  --namespace my-project \
  --title "Pricing decision"

# Get a synthesized briefing (requires ANTHROPIC_API_KEY)
cd /path/to/my-project
kt

# Or search directly
kt search "pricing model" --namespace my-project

# List all nodes in a namespace
kt list --namespace my-project

# Generate embeddings (requires Ollama)
kt embed

# Review and compact stale knowledge
kt compact --detect-stale --dry-run --namespace my-project
kt compact --namespace my-project
```

## Architecture

- **Database:** SQLite with WAL mode, sqlite-vec for vector search
- **Embeddings:** Ollama `nomic-embed-text` (768-dim, local inference)
- **Summarization:** Claude API for compaction
- **Node States:** active → stale → compacted
- **Link Types:** supersedes, contradicts, related

## Commands

| Command | Description |
|---------|-------------|
| `kt` | Synthesized digest of recent knowledge |
| `kt capture <content>` | Save a knowledge node |
| `kt search <query>` | Semantic or keyword search |
| `kt list` | List nodes (filterable by namespace, status) |
| `kt show <id>` | Display a specific node |
| `kt link <source> <type> <target>` | Create relationship |
| `kt context` | Load structured context brief |
| `kt compact` | Compact stale knowledge clusters |
| `kt embed` | Generate pending embeddings |
| `kt stale` | List stale nodes |
| `kt stats` | Knowledge base statistics |
| `kt ns create/list` | Manage namespaces |
| `kt map <pattern> <ns>` | Map directories to namespaces |

## Claude Code Integration

Add to your project's `.claude/CLAUDE.md`:

```markdown
## Knowledge System

This project uses `kt` for knowledge tracking.

### Context Loading
- At session start: knowledge context is auto-loaded via session-start hook

### Ambient Lookups
- When you encounter a client name, strategic concept, or domain that may have prior knowledge, run `kt search "<topic>"` before proceeding

### After Meaningful Work
- Suggest `/capture` if decisions were made or insights emerged worth persisting
```

See `docs/claude-md-snippet.md` for the full snippet.

## Status

**v0.2.0** — Digest feature: type `kt` to get a synthesized briefing of recent knowledge. Smart caching, `kt list` command, and namespace-filtered stats. See [design notes](docs/design-digest-interaction.md).

The project was built in four implementation phases (CRUD → semantic search → Claude integration → compaction), but this is the first release now that all pieces work together.

## Requirements

- Node.js 18+
- [Ollama](https://ollama.ai) with `nomic-embed-text` model (for semantic search)
- `ANTHROPIC_API_KEY` environment variable (for compaction)

## License

MIT
