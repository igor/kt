---
name: kt
description: Browse knowledge tracker context and nodes
user-invocable: true
---

# Browse Knowledge Tracker

Interactive browser for kt knowledge base. Shows context, nodes, and allows navigation.

## Process

1. **Determine namespace:**
   - If user specified a namespace, use it
   - Otherwise, show available namespaces and ask which to browse
   - Option to show "all" namespaces

2. **Load and display context:**

```bash
kt context --namespace <ns>
```

3. **Present the context:**
   - Show total node count
   - List active nodes with summaries (first 150 chars)
   - Highlight stale alerts if any
   - Show any conflicts

4. **Offer navigation:**
   - "Want to see full details for any node? (provide ID)"
   - "Search for something specific?"
   - "See all nodes in this namespace?"

5. **If user selects a node:**
   - Run `kt show <id>`
   - Display formatted content
   - Show links and offer to navigate to them

## Formatting

Present context in a clean, scannable format:

```
📚 Namespace: <name> (X active nodes, Y stale)

Active Knowledge:
  • kt-abc123  Title Here
    Summary preview (first 150 chars)...
    Updated: 2026-02-11 | Links: 3

  • kt-def456  Another Title
    Another summary...
    Updated: 2026-02-10 | Links: 1

⚠️  Stale Alerts:
  • kt-old789  Old Title [superseded]

Commands:
  - /kt-show <id> — View full details
  - /kt-search <query> — Search this namespace
```

## Guidelines

- Default to showing the namespace from current session context if available
- Keep summaries brief (150 chars max) for scannability
- Always offer next actions (show node, search, navigate links)
- Format nicely with emojis for visual hierarchy
- If many nodes (>10), group by creation date or show most recent first

## Example

```
User: /kt

Claude: Which namespace would you like to browse?
Available: kt, clients, ep-advisory, personal

User: kt

Claude: [runs kt context --namespace kt]

📚 Namespace: kt (9 active nodes, 1 stale)

Active Knowledge:
  • kt-6ed7ab  Node status lifecycle and transitions
    Node status transitions: active → stale → compacted. Status is updated via updateNodeStatus()...
    Updated: 2026-02-11 | Links: 3

  • kt-dc1152  Link re-pointing during compaction
    When a cluster is compacted, we re-point external inbound links to the new summary node...
    Updated: 2026-02-11 | Links: 3

  [... 7 more nodes ...]

⚠️  Stale Alert:
  • kt-273efe  kt project status [superseded]

Want to see full details for any node?
```
