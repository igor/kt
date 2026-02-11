---
name: kt-show
description: Display full details of a knowledge node
user-invocable: true
---

# Show Knowledge Node

Display full details of a specific kt knowledge node with navigation options.

## Process

1. **Get node ID:**
   - From user invocation (`/kt-show kt-abc123`)
   - Or prompt: "Which node would you like to see? (provide ID)"

2. **Fetch node:**

```bash
kt show <id>
```

3. **Fetch links (if any):**

```bash
# Get outbound links
sqlite3 ~/.kt/kt.db "SELECT link_type, target_id FROM links WHERE source_id='<id>'"

# Get inbound links
sqlite3 ~/.kt/kt.db "SELECT link_type, source_id FROM links WHERE target_id='<id>'"
```

4. **Present formatted:**
   - Title (if any) as header
   - Metadata (namespace, status, dates, tags)
   - Full content (nicely formatted)
   - Links section (inbound and outbound)
   - Compaction info (if compacted)

5. **Offer navigation:**
   - "View linked nodes?"
   - "Search for similar?"
   - "Back to namespace browser?"

## Formatting

Present node details clearly:

```
# Title Here

📍 Namespace: kt
📊 Status: active
📅 Created: 2026-02-11 09:48:30
📅 Updated: 2026-02-11 09:48:30
🏷️  Tags: pricing, decision
🆔 ID: kt-abc123

## Content

[Full content here, formatted nicely]

## Links

**Links Out** (3):
  • supersedes → kt-old456 "Old pricing model"
  • related → kt-xyz789 "Pricing tiers"
  • related → kt-def012 "Enterprise features"

**Links In** (2):
  • kt-ghi345 "Q4 planning" → related
  • kt-jkl678 "Revenue model" → related

---

Commands:
  - /kt-show <linked-id> — View linked node
  - /kt-search <term> — Find related
  - /kt — Back to browser
```

## Special Cases

**If node is stale:**
```
⚠️  Status: stale (since 2026-01-15)
This node has been marked stale. It may be superseded or outdated.
```

**If node is compacted:**
```
📦 Status: compacted
This node was compacted into: kt-summary99
View summary: /kt-show kt-summary99
```

**If no links:**
```
## Links
No links (orphan node)
```

## Guidelines

- Format content as markdown if it looks like markdown
- Truncate very long content (>2000 chars) with "... [truncated, showing first 2000 chars]"
- For linked nodes, fetch titles to show context (not just IDs)
- Always offer to navigate to linked nodes
- If node has many links (>10), group by link type
- Highlight important metadata (stale status, compaction info)

## Example

```
User: /kt-show kt-cc9bb5

Claude: [runs kt show kt-cc9bb5 and fetches links]

# Compaction pipeline architecture

📍 Namespace: kt
📊 Status: active
📅 Created: 2026-02-11 09:48:30
📅 Updated: 2026-02-11 09:48:30
🆔 ID: kt-cc9bb5

## Content

Phase 4 implements a three-pass compaction pipeline: (1) staleness detection marks old/superseded nodes as stale, (2) cluster detection groups stale nodes by link graph and semantic similarity, (3) compaction sends each cluster to Claude for summarization, creates a summary node, and marks originals as compacted. All orchestrated via 'kt compact' CLI command with --dry-run for preview.

## Links

**Links Out** (3):
  • related → kt-658e80 "kt implementation complete"
  • related → kt-273efe "kt project status" [stale]
  • related → kt-482bd7 "kt storage architecture"

**Links In** (4):
  • kt-c18153 "Staleness detection design" → related
  • kt-49a0e4 "Cluster detection via graph + semantic similarity" → related
  • kt-05f17f "Why Claude API for summarization" → related
  • kt-dc1152 "Link re-pointing during compaction" → related

---

Want to view any of these linked nodes?
```
