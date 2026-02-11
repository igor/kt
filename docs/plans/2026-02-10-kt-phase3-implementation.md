# Knowledge Tracker (kt) — Phase 3: Context Loading

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make sessions start with relevant knowledge automatically via a Claude Code session-start hook, and add CLAUDE.md instructions for ambient mid-conversation lookups.

**Architecture:** A session-start hook shell script calls `kt context --format json` and outputs the result. Claude Code captures this as session context. The `kt context` command already exists from Phase 1 — this phase improves it with link counts and better summaries, adds the hook infrastructure, adds a `/capture` Claude Code skill, and wires everything together.

**Tech Stack:** Bash (hook script), Claude Code hooks API (settings.json), existing kt CLI

**Reference:** Design doc at `docs/plans/2026-02-10-knowledge-tracker-design.md`, Phase 2 code in `src/`

**Important context for implementer:**
- The project is at `~/GitHub/kt/` — all source paths are relative to this
- `kt context` already works (see `src/cli/commands/context.ts`)
- Claude Code hooks go in `~/.claude/settings.json` under `"hooks"` key
- An existing session-start hook exists at `~/.claude/hooks/session-start.sh` (machine detection)
- Hook stdin receives JSON with `session_id`, `cwd`, `source` fields
- Hook stdout (exit 0) is added to Claude's session context
- The kt database is at `~/.kt/kt.db`
- `kt` is globally installed via `npm link`
- The project uses ESM (`"type": "module"`)
- Async commands use `program.parseAsync()`

---

### Task 1: Improve Context Command Output

The existing `kt context` works but the output could be richer. Add link count per node and a `total_nodes` count so the agent knows the scope of the knowledge base.

**Files:**
- Modify: `src/cli/commands/context.ts`
- Modify: `tests/cli/commands.test.ts`

**Step 1: Write failing test for improved context output**

Add this test to the existing `tests/cli/commands.test.ts` describe block. Find the existing context test and add below it:

```typescript
  it('context includes node_count and link_count per node', () => {
    kt('ns create ctx --name "Context Test"');
    const id1 = kt('capture "First knowledge" --namespace ctx --title "First"').match(/kt-[a-f0-9]{6}/)![0];
    const id2 = kt('capture "Second knowledge" --namespace ctx --title "Second"').match(/kt-[a-f0-9]{6}/)![0];
    kt(`link ${id1} related ${id2}`);

    const output = kt('context --namespace ctx --format json');
    const ctx = JSON.parse(output);

    expect(ctx.total_nodes).toBe(2);
    expect(ctx.active_nodes[0]).toHaveProperty('links_out');
  });
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/cli/commands.test.ts
```

Expected: FAIL — `total_nodes` not in output, `links_out` not in node

**Step 3: Update context command**

Replace the entire contents of `src/cli/commands/context.ts`:

```typescript
import { Command } from 'commander';
import { listNodes } from '../../core/nodes.js';
import { getConflicts, getLinks } from '../../core/links.js';
import { resolveNamespace } from '../../core/mappings.js';
import { getDatabase } from '../../db/connection.js';
import { detectFormat, type Format } from '../format.js';

interface ContextBrief {
  namespace: string | null;
  loaded_at: string;
  total_nodes: number;
  active_nodes: {
    id: string;
    title: string | null;
    summary: string;
    updated_at: string;
    links_out: number;
  }[];
  conflicts: {
    node_a: string;
    node_b: string;
    description: string | null;
  }[];
  stale_alerts: {
    id: string;
    title: string | null;
    stale_since: string | null;
    reason: string;
  }[];
}

function getStaleReason(node: any): string {
  const db = getDatabase();
  // Check if superseded
  const superseded = db.prepare(
    "SELECT COUNT(*) as c FROM links WHERE target_id = ? AND link_type = 'supersedes'"
  ).get(node.id) as { c: number };
  if (superseded.c > 0) return 'superseded';

  return `age`;
}

export function contextCommand(): Command {
  return new Command('context')
    .description('Load context brief for current project')
    .option('-n, --namespace <ns>', 'Namespace (auto-detected from cwd if omitted)')
    .option('-l, --limit <number>', 'Max active nodes', '5')
    .option('-f, --format <fmt>', 'Output format')
    .action((options) => {
      const namespace = options.namespace || resolveNamespace(process.cwd()) || null;
      const limit = parseInt(options.limit);
      const db = getDatabase();

      // Total node count for this namespace
      const countQuery = namespace
        ? db.prepare("SELECT COUNT(*) as c FROM nodes WHERE namespace = ? AND status = 'active'").get(namespace)
        : db.prepare("SELECT COUNT(*) as c FROM nodes WHERE status = 'active'").get();
      const totalNodes = (countQuery as { c: number }).c;

      const activeNodes = listNodes({
        namespace: namespace || undefined,
        status: 'active',
        limit,
      });

      const staleNodes = listNodes({
        namespace: namespace || undefined,
        status: 'stale',
        limit: 3,
      });

      const conflicts = getConflicts(namespace || undefined);

      const brief: ContextBrief = {
        namespace,
        loaded_at: new Date().toISOString(),
        total_nodes: totalNodes,
        active_nodes: activeNodes.map(n => ({
          id: n.id,
          title: n.title,
          summary: n.content.substring(0, 200) + (n.content.length > 200 ? '...' : ''),
          updated_at: n.updated_at,
          links_out: getLinks(n.id).length,
        })),
        conflicts: conflicts.map(c => ({
          node_a: c.nodeA,
          node_b: c.nodeB,
          description: c.context,
        })),
        stale_alerts: staleNodes.map(n => ({
          id: n.id,
          title: n.title,
          stale_since: n.stale_at,
          reason: getStaleReason(n),
        })),
      };

      const format: Format = options.format || detectFormat(Boolean(process.stdout.isTTY));

      if (format === 'json') {
        console.log(JSON.stringify(brief, null, 2));
      } else {
        console.log(`Context: ${namespace || '(all namespaces)'} (${totalNodes} active nodes)`);
        console.log('');
        if (brief.active_nodes.length > 0) {
          console.log('Active knowledge:');
          for (const n of brief.active_nodes) {
            const linkInfo = n.links_out > 0 ? ` [${n.links_out} links]` : '';
            console.log(`  [${n.id}] ${n.title || '(untitled)'}${linkInfo}`);
            console.log(`    ${n.summary}`);
          }
        }
        if (brief.conflicts.length > 0) {
          console.log('\nConflicts:');
          for (const c of brief.conflicts) {
            console.log(`  ${c.node_a} contradicts ${c.node_b}${c.description ? ': ' + c.description : ''}`);
          }
        }
        if (brief.stale_alerts.length > 0) {
          console.log('\nStale:');
          for (const n of brief.stale_alerts) {
            console.log(`  [${n.id}] ${n.title || '(untitled)'} — ${n.reason} (since ${n.stale_since})`);
          }
        }
        if (totalNodes === 0 && brief.stale_alerts.length === 0) {
          console.log('No knowledge captured yet. Use `kt capture` to start.');
        }
      }
    });
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/cli/commands.test.ts
```

Expected: ALL PASS

**Step 5: Run all tests**

```bash
npx vitest run
```

Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/cli/commands/context.ts tests/cli/commands.test.ts
git commit -m "feat: enrich context output with total_nodes, links_out, stale reasons"
```

---

### Task 2: Session-Start Hook Script

Create the shell script that Claude Code will call at session start. It reads `cwd` from stdin, calls `kt context`, and outputs the result.

**Files:**
- Create: `~/.claude/hooks/kt-context.sh`

**Step 1: Create the hook script**

`~/.claude/hooks/kt-context.sh`:
```bash
#!/bin/bash
# kt Knowledge Tracker — Session-Start Context Loader
# Reads cwd from Claude Code hook input, calls kt context, outputs result

# Read hook input from stdin
INPUT=$(cat)
CWD=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cwd',''))" 2>/dev/null)

# Use provided cwd or fall back to current directory
if [ -z "$CWD" ]; then
  CWD=$(pwd)
fi

# Check if kt is available
if ! command -v kt &> /dev/null; then
  # Try npx path as fallback
  KT_CMD="npx --yes tsx /Users/zeigor/GitHub/kt/src/index.ts"
else
  KT_CMD="kt"
fi

# Run kt context from the detected directory
# kt will auto-detect namespace from cwd via project mappings
cd "$CWD" 2>/dev/null
CONTEXT=$($KT_CMD context --format json 2>/dev/null)

# Only output if we got a valid response with actual nodes
if [ -n "$CONTEXT" ]; then
  TOTAL=$(echo "$CONTEXT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total_nodes',0))" 2>/dev/null)
  if [ "$TOTAL" != "0" ] && [ -n "$TOTAL" ]; then
    echo "KT_KNOWLEDGE_CONTEXT:"
    echo "$CONTEXT"
  fi
fi

exit 0
```

**Step 2: Make it executable**

```bash
chmod +x ~/.claude/hooks/kt-context.sh
```

**Step 3: Test it manually**

```bash
# Simulate hook input
echo '{"cwd":"/Users/zeigor/GitHub/kt","source":"startup"}' | ~/.claude/hooks/kt-context.sh
```

Expected: Either JSON context output (if nodes exist for that namespace) or no output (if no mapped namespace or no nodes)

**Step 4: Test with a namespace that has data**

```bash
# First, make sure there's data
kt ns create test --name "Test"
kt capture "Phase 3 context loading works" --namespace test --title "Phase 3 test"

# Now test with explicit namespace
kt context --namespace test --format json
```

Expected: JSON with the captured node

**Step 5: Commit the hook script**

```bash
git -C ~/GitHub/kt add -f ~/.claude/hooks/kt-context.sh 2>/dev/null || true
```

Note: The hook script lives outside the repo. No git commit needed — just verify it exists and is executable.

---

### Task 3: Register Hook in Claude Code Settings

Wire the hook script into Claude Code's settings so it runs at every session start.

**Files:**
- Modify: `~/.claude/settings.json`

**Step 1: Read the current settings**

Read `~/.claude/settings.json` first to understand what's already there.

Current contents:
```json
{
  "model": "sonnet",
  "enabledPlugins": {
    "superpowers@superpowers-marketplace": true,
    "frontend-design@claude-code-plugins": true
  }
}
```

**Step 2: Add the hooks configuration**

Update `~/.claude/settings.json` to:

```json
{
  "model": "sonnet",
  "enabledPlugins": {
    "superpowers@superpowers-marketplace": true,
    "frontend-design@claude-code-plugins": true
  },
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "/Users/zeigor/.claude/hooks/session-start.sh",
            "timeout": 10
          },
          {
            "type": "command",
            "command": "/Users/zeigor/.claude/hooks/kt-context.sh",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

This registers both the existing machine-detection hook AND the new kt context hook. Both run on every session start. The kt hook has a 15-second timeout to allow for Ollama latency if needed.

**Step 3: Verify the hook fires**

Open a new Claude Code session in any directory:
```bash
cd ~/GitHub/kt && claude
```

Expected: Claude should see the knowledge context in its system prompt. You can verify by asking Claude "what knowledge context was loaded at session start?"

---

### Task 4: Create `/capture` Claude Code Skill

Create a skill that Claude Code users can invoke with `/capture` to save knowledge from the current session.

**Files:**
- Create: `~/GitHub/kt/commands/capture.md`

**Step 1: Create the commands directory**

```bash
mkdir -p ~/GitHub/kt/commands
```

**Step 2: Create the skill file**

`~/GitHub/kt/commands/capture.md`:
```markdown
---
name: capture
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
User: /capture

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
```

**Step 3: Verify the skill file is valid**

```bash
cat ~/GitHub/kt/commands/capture.md | head -5
```

Expected: Should show the frontmatter with `name: capture`

**Step 4: Commit**

```bash
cd ~/GitHub/kt && git add commands/capture.md
git commit -m "feat: /capture Claude Code skill for session knowledge capture"
```

---

### Task 5: CLAUDE.md Ambient Lookup Instructions

Add instructions to the kt project's CLAUDE.md (and create a template for other projects) that tell Claude when and how to check the knowledge tracker mid-conversation.

**Files:**
- Create: `~/GitHub/kt/.claude/CLAUDE.md`

**Step 1: Create the CLAUDE.md**

```bash
mkdir -p ~/GitHub/kt/.claude
```

`~/GitHub/kt/.claude/CLAUDE.md`:
```markdown
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
- Suggest `/capture` if decisions were made or insights emerged worth persisting
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
```

**Step 2: Commit**

```bash
cd ~/GitHub/kt && git add .claude/CLAUDE.md
git commit -m "feat: CLAUDE.md with ambient lookup instructions"
```

---

### Task 6: Ambient Lookup Template for Other Projects

Create a reusable snippet that can be added to any project's CLAUDE.md to enable kt ambient lookups.

**Files:**
- Create: `~/GitHub/kt/docs/claude-md-snippet.md`

**Step 1: Create the snippet**

`~/GitHub/kt/docs/claude-md-snippet.md`:
```markdown
# kt Integration Snippet for CLAUDE.md

Copy the section below into any project's CLAUDE.md to enable knowledge tracker integration.

---

## Knowledge System

You have access to `kt` (knowledge tracker). Use it:

- **At session start:** Context is auto-loaded via hook. Check for any knowledge brief in the session context.
- **During conversation:** When you encounter a client name, strategic concept, or domain you may have prior knowledge about, run `kt search "<topic>"` before proceeding. Surface findings briefly, don't dump.
- **After meaningful work:** Suggest `/capture` if decisions were made or insights emerged worth persisting. Each capture should be self-contained — readable without the current session context.

### Quick Reference

```bash
kt search "<query>"                    # Find relevant knowledge
kt capture "<content>" -n <namespace>  # Save knowledge
kt context                             # Load full context brief
kt show <id> --with-links              # Inspect a specific node
```
```

**Step 2: Commit**

```bash
cd ~/GitHub/kt && git add docs/claude-md-snippet.md
git commit -m "docs: reusable CLAUDE.md snippet for kt integration"
```

---

### Task 7: Map Initial Project Directories

Set up the first project-to-namespace mappings so context loading has something to work with.

**Files:**
- None (CLI commands only)

**Step 1: Create namespaces for your main contexts**

```bash
kt ns create personal --name "Personal Knowledge"
kt ns create ep-advisory --name "EP Advisory"
kt ns create kt --name "Knowledge Tracker Development"
```

**Step 2: Map directories to namespaces**

```bash
kt map add "/Users/zeigor/GitHub/kt" kt
kt map add "/Users/zeigor/Library/CloudStorage/GoogleDrive-hello@igorschwarzmann.com/Shared drives/Explicit Protocol" ep-advisory
```

**Step 3: Verify mappings**

```bash
kt map list
```

Expected output:
```
/Users/zeigor/GitHub/kt → kt
/Users/zeigor/Library/CloudStorage/GoogleDrive-hello@igorschwarzmann.com/Shared drives/Explicit Protocol → ep-advisory
```

**Step 4: Test context loading from the kt directory**

```bash
cd ~/GitHub/kt && kt context
```

Expected: Context for the "kt" namespace (may be empty if no nodes captured there yet)

**Step 5: Capture initial test knowledge**

```bash
kt capture "kt uses SQLite with sqlite-vec for local vector search. No external database needed." --namespace kt --title "kt storage architecture"
kt capture "Phase 1-2 complete. CLI with capture, search, semantic search, embeddings, auto-linking all working." --namespace kt --title "kt project status"
```

**Step 6: Verify context loading works end-to-end**

```bash
cd ~/GitHub/kt && kt context --format json
```

Expected: JSON with the two nodes you just captured

---

### Task 8: Integration Test — Full Flow

Run through the complete flow to verify everything works together.

**Step 1: Test the hook script with simulated input**

```bash
echo '{"cwd":"/Users/zeigor/GitHub/kt","source":"startup","session_id":"test-123"}' | ~/.claude/hooks/kt-context.sh
```

Expected: JSON output with `KT_KNOWLEDGE_CONTEXT:` header and the context brief

**Step 2: Test with an unmapped directory**

```bash
echo '{"cwd":"/tmp","source":"startup","session_id":"test-456"}' | ~/.claude/hooks/kt-context.sh
```

Expected: No output (or empty — unmapped directory has no namespace)

**Step 3: Test capture → context round-trip**

```bash
# Capture something new
kt capture "Session-start hooks inject kt context into Claude automatically" --namespace kt --title "Context loading mechanism"

# Verify it shows up in context
kt context --namespace kt --format json | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Nodes: {d[\"total_nodes\"]}, Latest: {d[\"active_nodes\"][0][\"title\"]}')"
```

Expected: `Nodes: 3, Latest: Context loading mechanism`

**Step 4: Test the /capture skill exists**

```bash
cat ~/GitHub/kt/commands/capture.md | head -1
```

Expected: `---` (frontmatter start)

**Step 5: Run full test suite**

```bash
cd ~/GitHub/kt && npx vitest run
```

Expected: ALL PASS

**Step 6: Build**

```bash
npm run build
```

Expected: No errors

**Step 7: Commit any fixes**

```bash
cd ~/GitHub/kt && git add -A
git commit -m "fix: adjustments from Phase 3 integration testing"
```

---

### Task 9: Final Cleanup + Tag

**Step 1: Run full test suite**

```bash
cd ~/GitHub/kt && npx vitest run
```

Expected: ALL PASS

**Step 2: Verify global install is current**

```bash
cd ~/GitHub/kt && npm run build && npm link
```

**Step 3: Final verification**

```bash
# kt should work from anywhere
cd /tmp && kt stats
```

Expected: Shows stats for the global knowledge base

**Step 4: Tag**

```bash
cd ~/GitHub/kt && git tag v0.3.0
```

Phase 3 complete.

---

## What You Have After Phase 3

1. **Auto-loaded context** — Every Claude Code session starts with relevant knowledge from kt, auto-detected by working directory
2. **`/capture` skill** — Save knowledge from any session with a conversational flow
3. **Ambient lookup instructions** — CLAUDE.md tells the agent when to check kt mid-conversation
4. **Project mappings** — kt directory → kt namespace, EP Advisory directory → ep-advisory namespace
5. **Reusable snippet** — Drop into any project's CLAUDE.md to enable kt integration

## What's NOT Done Yet (Phase 4)

- Staleness detection (age-based auto-stale)
- Cluster detection for compaction
- Claude-powered summarization
- `kt compact` command
- `/compact` skill
