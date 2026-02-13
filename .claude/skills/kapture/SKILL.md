---
name: kapture
description: Capture knowledge from this session into kt
user-invocable: true
---

# Capture Knowledge

Help the user save important knowledge from this session to their knowledge tracker (kt).

## Process

1. Review the conversation so far and identify knowledge worth persisting:
   - Decisions made and their rationale
   - Client context or preferences learned
   - Strategic insights or patterns noticed
   - Technical discoveries or solutions found

2. For each piece of knowledge, ask the user if they want to capture it. Present it as a brief summary.

3. For each approved item, run the kt capture command:

```bash
kt capture "<content>" --namespace <ns> --title "<title>" --tags "<comma,separated,tags>"
```

Where:
- `<content>` is a clear, self-contained summary (1-3 sentences)
- `<ns>` is detected from the current working directory (kt auto-detects), or ask the user
- `<title>` is a short descriptive title
- `<tags>` are 2-4 relevant keywords

4. After capturing, report what was saved:
   - Node IDs created
   - Any similar existing knowledge that was found
   - Any auto-links that were created

## Guidelines

- Each capture should be **self-contained** — readable without session context
- Prefer **facts and decisions** over process notes ("Client chose X because Y" not "we discussed X")
- Keep content **concise** — 1-3 sentences per node
- Don't capture trivial or temporary information
- If the user says "capture everything", identify the 3-5 most important items, don't dump the whole session

## Example

```
User: /kapture

Claude: From this session, I identified these worth capturing:

1. **EP Advisory pricing**: Decided on three-tier model (embedded advisory, salon, sprints). Rationale: matches different client commitment levels.

2. **Client X preference**: Rejected sprint format — too disruptive to their quarterly planning cycle.

Want me to capture both, or just specific ones?

User: Both

Claude: [runs kt capture for each]
Captured:
- kt-a1b2: "EP Advisory pricing decision" (ep-advisory)
  → Auto-linked to kt-c3d4 "Service model discussion"
- kt-e5f6: "Client X planning preference" (clients)
  → Similar existing: kt-g7h8 "Client X initial meeting notes"
```
