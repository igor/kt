# Knowledge Tracker (kt) — Project Instructions

## Knowledge System

This project builds `kt`, a CLI knowledge tracker. You have access to the `kt` command.

### Context Loading
- At session start: knowledge context is auto-loaded via session-start hook
- The hook calls `kt context --format json` and injects the result

### Ambient Lookups
- When you encounter a client name, strategic concept, or domain that may have prior knowledge, run `kt search "<topic>"` before proceeding
- Surface findings briefly — don't dump entire nodes
- If search returns nothing, proceed normally

### After Meaningful Work
- Suggest `/kapture` if decisions were made or insights emerged worth persisting
- Don't capture trivial or temporary information
- Each captured node should be self-contained and readable without session context

### Commands Reference
- `kt capture "<content>" --namespace <ns> --title "<title>"` — Save knowledge
- `kt search "<query>"` — Search by keyword (or semantic if Ollama running)
- `kt context --namespace <ns>` — Load context brief
- `kt show <id>` — View a specific node
- `kt link <source> <type> <target>` — Create relationship (supersedes|contradicts|related)
- `kt stale` — List stale nodes
- `kt stats` — Knowledge base overview
- `kt embed` — Generate pending embeddings
