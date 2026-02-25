---
name: kompact
description: Review and compact stale knowledge in kt
user-invocable: true
---

# Compact Knowledge

Help the user review and compact stale knowledge nodes in their knowledge tracker.

## Process

1. First, run staleness detection and dry-run to see what's available:

```bash
kt compact --detect-stale --dry-run --format json
```

2. Present the results to the user:
   - How many nodes were newly marked stale
   - How many clusters were detected
   - For each cluster: the node titles and a brief preview of contents

3. Ask the user which clusters to compact using the selection UX:

   **2–4 clusters:** Use `AskUserQuestion` with `multiSelect: true`. One option per cluster, plus "All clusters". The built-in "Other" field lets the user add notes.

   **5+ clusters:** Prompt after the list:
   > `all` · `1 3` · `n` — which to compact?

   Parse: `y`/`all`/`a` = everything · numbers (space or comma separated) = those clusters · `n`/`none`/`skip` = nothing.

4. For approved clusters, run the actual compaction:

```bash
kt compact --namespace <ns>
```

5. Report the results:
   - Summary nodes created (ID and title)
   - Number of nodes compacted
   - Any failures

## Guidelines

- Always show dry-run first — never compact without the user seeing what will happen
- If no clusters are found, suggest checking staleness thresholds or waiting for more knowledge to accumulate
- If ANTHROPIC_API_KEY is not set, inform the user they need it for summarization
- After compaction, suggest running `kt stats` to see the updated knowledge base state

## Example

```
User: /kompact

Claude: Let me check for compaction candidates...

[runs kt compact --detect-stale --dry-run]

Found 2 clusters ready for compaction:

Cluster 1: "Client X engagement" (4 nodes, namespace: clients)
  - kt-a1b2: "Client X initial meeting"
  - kt-c3d4: "Client X pricing discussion"
  - kt-e5f6: "Client X sprint rejection"
  - kt-g7h8: "Client X quarterly preference"

Cluster 2: "Pricing model evolution" (3 nodes, namespace: ep-advisory)
  - kt-i9j0: "Three-tier pricing"
  - kt-k1l2: "Dropped basic tier"
  - kt-m3n4: "Enterprise tier details"

→ [AskUserQuestion multiSelect with "Cluster 1: Client X engagement", "Cluster 2: Pricing model evolution", "All clusters"]

User: [selects both]

Claude: [runs kt compact]
Done:
- kt-o5p6: "Compacted: Client X initial meeting, Client X pricing discussion..." (4 nodes → 1)
- kt-q7r8: "Compacted: Three-tier pricing, Dropped basic tier..." (3 nodes → 1)

7 nodes compacted into 2 summaries. Run `kt stats` to see updated totals.
```
