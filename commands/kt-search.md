---
name: kt-search
description: Search knowledge tracker by keyword or semantic similarity
user-invocable: true
---

# Search Knowledge Tracker

Search kt knowledge base using keyword or semantic search.

## Process

1. **Get search parameters:**
   - Query (required) - from user invocation or prompt
   - Namespace (optional) - ask if not specified
   - Suggest relevant namespaces based on current session context

2. **Run search:**

```bash
# Try semantic search first (if Ollama available)
kt search "<query>" --namespace <ns>

# If semantic search fails (no embeddings), falls back to keyword search automatically
```

3. **Present results:**
   - Show count of results found
   - List results with titles and content previews
   - Show relevance/distance for semantic results
   - Indicate if this was semantic or keyword search

4. **Offer actions:**
   - View full details for any result
   - Refine search
   - Browse the namespace

## Formatting

Present results clearly:

```
🔍 Search: "compaction pipeline" in namespace: kt
Found 5 results (semantic search)

1. kt-cc9bb5  Compaction pipeline architecture  [distance: 0.23]
   Phase 4 implements a three-pass compaction pipeline: (1) staleness detection marks old/superseded...
   Updated: 2026-02-11

2. kt-c18153  Staleness detection design  [distance: 0.45]
   Staleness detection uses multiple signals: (1) age threshold (default 60 days...
   Updated: 2026-02-11

[... more results ...]

Commands:
  - /kt-show <id> — View full node
  - /kt-search <new-query> — New search
  - /kt — Browse namespace
```

## Guidelines

- Always indicate if search was semantic or keyword
- If semantic search fails (Ollama not available), clearly state "using keyword search instead"
- Truncate content previews to ~100 chars
- Sort by relevance (distance for semantic, best match first for keyword)
- If no results, suggest:
  - Try broader terms
  - Check spelling
  - Browse namespace to see what's available
- Limit to top 10 results by default, offer to see more

## Examples

```
User: /kt-search compaction

Claude: Which namespace? (or 'all' to search everything)
Available: kt, clients, ep-advisory

User: kt

Claude: [runs kt search "compaction" --namespace kt]

🔍 Search: "compaction" in kt
Found 6 results (semantic search via Ollama)

1. kt-cc9bb5  Compaction pipeline architecture
   Phase 4 implements a three-pass compaction pipeline...

2. kt-dc1152  Link re-pointing during compaction
   When a cluster is compacted, we re-point external inbound links...

[... more results ...]

Want full details for any of these?
```

---

```
User: /kt-search pricing model namespace:clients

Claude: [runs kt search "pricing model" --namespace clients]

🔍 Search: "pricing model" in clients
Found 0 results (keyword search - Ollama not available)

No matches found. Try:
• Broader terms: "pricing", "cost", "tier"
• Browse namespace: /kt to see all available knowledge
```
