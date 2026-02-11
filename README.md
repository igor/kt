# kt — Knowledge Tracker

CLI-first knowledge management for AI agents. Capture insights, build context, and let your knowledge base clean itself over time.

## Features

- **Capture & Link:** Save knowledge nodes with automatic relationship detection
- **Semantic Search:** Vector-based similarity search via Ollama embeddings
- **Smart Context:** Auto-loaded session context for AI agents
- **Auto-Compaction:** Stale knowledge clusters are summarized via Claude API
- **Namespaces:** Organize knowledge by project or domain
- **Local-First:** SQLite + sqlite-vec, no external database needed

## Install

```bash
git clone <your-repo>
cd kt
npm install
npm run build
npm link
```

## Quick Start

```bash
# Create a namespace
kt ns create my-project --name "My Project"

# Capture knowledge
kt capture "We decided on two-tier pricing: pro and enterprise" \
  --namespace my-project \
  --title "Pricing decision"

# Search semantically (requires Ollama)
kt search "pricing model" --namespace my-project

# Generate embeddings
kt embed

# Load context (used by AI agents)
kt context --namespace my-project

# Review and compact stale knowledge
kt compact --detect-stale --dry-run --namespace my-project
kt compact --namespace my-project  # requires ANTHROPIC_API_KEY
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
| `kt capture <content>` | Save a knowledge node |
| `kt search <query>` | Semantic or keyword search |
| `kt show <id>` | Display a specific node |
| `kt link <source> <type> <target>` | Create relationship |
| `kt context` | Load structured context brief |
| `kt compact` | Compact stale knowledge clusters |
| `kt embed` | Generate pending embeddings |
| `kt stale` | List stale nodes |
| `kt stats` | Knowledge base statistics |
| `kt ns create/list` | Manage namespaces |

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

## Development Phases

- **Phase 1:** Core CRUD, links, namespaces, keyword search
- **Phase 2:** Semantic search, Ollama embeddings, smart capture, auto-linking
- **Phase 3:** Context loading, session-start hooks, `/capture` skill
- **Phase 4:** Staleness detection, clustering, Claude summarization, compaction pipeline

## Status

✅ **v0.4.0** — All 4 phases implemented. Full knowledge lifecycle: capture → search → context → stale → cluster → compact → repeat.

## Requirements

- Node.js 18+
- [Ollama](https://ollama.ai) with `nomic-embed-text` model (for semantic search)
- `ANTHROPIC_API_KEY` environment variable (for compaction)

## License

MIT
