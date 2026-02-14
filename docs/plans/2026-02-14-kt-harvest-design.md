---
title: "kt-harvest: Automated Knowledge Extraction from Claude Code Sessions"
created: 2026-02-14
status: approved
type: design
scope: New module for kt ecosystem
---

# kt-harvest: Automated Knowledge Extraction from Claude Code Sessions

## Problem

Knowledge capture from Claude Code sessions currently requires manual invocation of `/kapture` at session end. This means:
- Knowledge gets lost when you forget to capture
- The human decides per-session what's worth keeping — doesn't scale
- 111+ sessions of historical knowledge sit unprocessed in `~/.claude/projects/`

## Core Idea

Apply "Strategy-as-Protocol" thinking: instead of a human judging each session, encode the capture logic as a protocol that a local LLM can execute autonomously. The same principles that make strategy delegable (explicit rules, clear taxonomy, structured space for judgment) make knowledge capture delegable.

Inspired by the OpenAI engineering team's approach: don't write one massive instruction file. Write golden principles + progressive disclosure. Let `/kompact` handle drift cleanup rather than demanding perfection from the extraction.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────┐     ┌───────────┐     ┌──────────┐     ┌────────┐
│ ccvault sync │ ──▶ │ kt-harvest   │ ──▶ │ SCANNER │ ──▶ │ EXTRACTOR │ ──▶ │ VERIFIER │ ──▶ │ kt     │
│ (index new)  │     │ (orchestrator)│     │ (flag)  │     │ (produce)  │     │ (gate)   │     │capture │
└─────────────┘     └──────────────┘     └─────────┘     └───────────┘     └──────────┘     └────────┘
```

### Three-Agent Pipeline

Inspired by Erik Garrison's observation that complex AI workflows need **separate agents with separate definitions**, each responsible for one clear job. A single agent doing scanning, classifying, extracting, and quality-checking simultaneously produces worse results than three focused agents — each sees less context, gets clearer instructions, and can be evaluated independently.

**Agent 1 — Scanner:** Reads the preprocessed transcript. For each turn, outputs YES or NO: does this turn contain potential knowledge? No extraction, no formatting — just flagging. Short, focused prompt. The golden principles live here.

**Agent 2 — Extractor:** Receives only the flagged turns (not the full transcript). Produces structured JSON nodes with title, content, type, namespace, tags. The node type taxonomy lives here.

**Agent 3 — Verifier:** Receives each candidate node. Checks: Is it self-contained? Is it genuinely worth keeping (not just interesting)? Does it duplicate knowledge already in kt? Pass or reject. This is the custodian — the quality gate before anything enters kt.

This design means:
- Each agent has a **short, focused prompt** (better for local models with limited context)
- The scanner filters out ~80% of turns, so the extractor sees only signal
- The verifier catches garbage before it enters kt (not after, via `/kompact`)
- Each agent can be evaluated and improved independently
- Agent definitions can evolve based on evaluation results (per Erik's "what evolves are agent definitions")

### Components

**ccvault** (external, not forked): Parses raw Claude Code JSONL session files into a searchable SQLite database. Provides CLI for listing sessions, exporting transcripts, and searching. Maintained upstream at github.com/2389-research/ccvault.

**kt-harvest** (new, this project): Orchestration script that bridges ccvault and kt. Reads unprocessed sessions from ccvault, runs them through the three-agent pipeline, and pipes verified nodes into `kt capture`.

**Ollama** (existing infrastructure): Runs on Mac Mini. Already serves `nomic-embed-text` for kt embeddings. Will additionally run an instruction-following model shared across all three agents (same model, different prompts).

**kt** (existing): Receives nodes via `kt capture`. Handles dedup detection, auto-linking, namespace routing, and eventual compaction via `/kompact`.

## Agent Definitions

Three separate prompt files, each giving one agent clear, focused instructions. Each agent has its own definition that can be evaluated and evolved independently.

### Agent 1: Scanner (`protocols/scanner.md`)

**Job:** Read the transcript. Flag which turns contain potential knowledge. Nothing else.

**Prompt contains:**
- The 5 golden principles (what counts as knowledge)
- Clear YES/NO output format per turn
- Examples of turns that ARE knowledge vs. turns that are NOT

**Golden Principles** (the scanner's decision rules):
1. **Capture decisions, not actions.** "We chose X because Y" is knowledge. "We ran the build" is not.
2. **Capture rationale, not just outcomes.** The "why" compounds. The "what" is in git.
3. **Capture contradictions.** When reality contradicted an assumption — high-value.
4. **Capture framework refinements.** When a model/approach got sharpened through use.
5. **Skip mechanical execution.** Debugging loops, CSS fixes, "run the tests" — process, not knowledge.

**Meta-principle:** When in doubt, flag NO. The verifier catches false positives, but flooding the extractor with noise degrades everything downstream.

**Expected output:** JSON array of turn numbers/indices that contain potential knowledge, or `[]` for sessions with nothing.

### Agent 2: Extractor (`protocols/extractor.md`)

**Job:** Take flagged turns only. Produce structured knowledge nodes. Focus on making each node self-contained.

**Prompt contains:**
- Node type taxonomy with trigger conditions
- 2-3 real examples per type (drawn from existing kt nodes)
- Expected JSON output format
- Explicit instruction: nodes must be readable without the session transcript

**Node Type Taxonomy:**

| Type | Trigger | Example |
|------|---------|---------|
| Decision | A choice was made with stated reasoning | "Chose ccvault over forking because upstream is actively maintained" |
| Contradiction | Something believed turned out wrong | "Assumed 16GB RAM on Mac Mini, actually 24GB — opens up larger models" |
| Insight | A pattern, connection, or reframe emerged | "Strategy-as-Protocol logic applies to knowledge capture itself" |
| Context | Client preferences, project constraints, domain knowledge | "Mac Mini Ollama models must be stored on /Volumes/Storage" |
| Refinement | An existing framework/approach was improved | "Kompact staleness threshold adjusted from 60 to 30 days for active projects" |

**Expected output:** JSON array of nodes:

```json
[
  {
    "type": "decision",
    "title": "Short descriptive title",
    "content": "Self-contained description of the knowledge. Readable without session context.",
    "namespace": "detected-from-project-path",
    "tags": ["relevant", "tags"]
  }
]
```

### Agent 3: Verifier (`protocols/verifier.md`)

**Job:** Quality gate. Review each candidate node before it enters kt. Pass or reject.

**Prompt contains:**
- Verification checklist (self-contained? genuinely worth keeping? not a duplicate?)
- Access to existing kt node titles/summaries for dedup checking
- Clear PASS/REJECT output per node with brief reason

**Verification checks:**
1. **Self-contained?** Can you understand this node without reading the session transcript?
2. **Worth keeping?** Is this genuinely knowledge that compounds, or just an interesting fact from one session?
3. **Not duplicate?** Does this substantially overlap with existing kt knowledge? (existing node titles provided as context)
4. **Well-formed?** Does the title accurately describe the content? Are tags relevant?

**Expected output:** JSON array of verdicts:

```json
[
  { "index": 0, "verdict": "PASS" },
  { "index": 1, "verdict": "REJECT", "reason": "Duplicates existing node about Ollama storage paths" }
]
```

### Protocol Evolution

After model evaluation (and periodically during operation), agent definitions are updated based on failure patterns:
- Scanner flagging too many mechanical turns → tighten principles, add negative examples
- Extractor producing nodes that aren't self-contained → add more examples of good vs. bad nodes
- Verifier letting through duplicates → expand the existing-knowledge context it receives

The three-agent architecture makes this evolution targeted: you fix the agent that's failing, not a monolithic prompt where changes have unpredictable side effects.

## Pipeline Details

### Orchestration Flow

1. Run `ccvault sync` to pick up new/updated sessions
2. Get list of all sessions from ccvault (`ccvault list-sessions --json`)
3. Filter against processed sessions list (stored in `~/.kt-harvest/state.json`)
4. For each unprocessed session:
   a. Export transcript: `ccvault export <session-id>`
   b. Pre-process: truncate tool output blocks, keep human/assistant dialogue
   c. **Agent 1 (Scanner):** Send preprocessed transcript to Ollama with `scanner.md`. Get back list of flagged turn indices.
   d. If no turns flagged → mark session processed with 0 nodes, continue.
   e. Extract flagged turns from transcript into a focused document.
   f. **Agent 2 (Extractor):** Send flagged turns to Ollama with `extractor.md`. Get back candidate nodes as JSON.
   g. Fetch existing kt node titles for the relevant namespace: `kt list -n <ns> --format json`
   h. **Agent 3 (Verifier):** Send candidate nodes + existing kt titles to Ollama with `verifier.md`. Get back PASS/REJECT verdicts.
   i. For each PASS node: `kt capture "<content>" --namespace <ns> --title "<title>" --tags "<tags>"`
   j. Mark session as processed in state file (record: scanned turns, extracted candidates, verified nodes)
5. Log summary per session and aggregate

### State Tracking

File: `~/.kt-harvest/state.json`

```json
{
  "last_run": "2026-02-14T15:30:00Z",
  "protocol_version": "1.0",
  "model": "qwen3:30b-q4",
  "processed_sessions": {
    "session-uuid": {
      "processed_at": "2026-02-14T15:30:00Z",
      "nodes_captured": 3,
      "model": "qwen3:30b-q4"
    }
  }
}
```

A `--reprocess` flag ignores the processed list for re-running after protocol updates. kt's dedup detection catches exact duplicates.

### Namespace Detection

ccvault knows the project path per session. kt knows which namespace maps to which directory (via `kt map`). kt-harvest bridges the two: look up the session's project path in kt's namespace mappings. Fall back to "default" namespace if no mapping exists.

### Transcript Pre-processing

Sessions can be long (hundreds of turns). To fit within model context and focus on knowledge-bearing content:
- Strip tool output blocks (file contents, command output, search results)
- Keep human messages and assistant reasoning/responses
- Keep tool call names (shows what was done) but not their full output
- If still too long, keep first 50% and last 30% of turns, cutting from the middle. Front-weighted because: (a) session beginnings contain goal framing and key design decisions, (b) local models have better recall on tokens seen earlier in context (per Erik Garrison's observation that "the first ~N tokens have decent recall and cross referencing but it gets much worse as you go on"), (c) session middles are where debugging loops and mechanical execution cluster

## Model Evaluation

### Candidates

Ollama on Mac Mini (M4, 24GB RAM). Models stored on `/Volumes/Storage/` (external drive — Mac Mini has limited internal storage). Set `OLLAMA_MODELS=/Volumes/Storage/ollama/models` or equivalent.

| Model | Size (Q4) | RAM est. | Strength |
|-------|-----------|----------|----------|
| Qwen3 30B | ~18-20GB | Tight, may compete with other services | Best reasoning in this class |
| Gemma 3 12-14B QAT | ~8-10GB | Comfortable headroom | Good structured output, leaves RAM for other tasks |
| Mistral Small 3.1 24B Instruct | ~14-16GB | Moderate | Strong instruction following |

### Test Protocol

Select 10 sessions spanning different types:
- 2-3 sessions where `/kapture` was previously run (known-good baseline)
- 2-3 pure debugging/mechanical sessions (should produce zero nodes)
- 2-3 strategy/writing sessions (should be rich)
- 1-2 mixed sessions

Run all three models against the same 10 sessions. Evaluate:

| Criterion | Weight | What it measures |
|-----------|--------|------------------|
| Precision | High | Did it capture things actually worth keeping? (noise rate) |
| Recall | Medium | Did it miss obvious decisions/insights? (gap rate) |
| Node quality | High | Are nodes self-contained and well-formed? |
| Silence on noise | High | Zero nodes for mechanical sessions? |

**Decision rule:** Best precision wins. Gaps are acceptable (knowledge can be captured later). Noise pollutes kt and creates work for `/kompact`.

## Scheduling

Runs on Mac Mini via cron. Suggested: every 2 hours during working hours, or daily.

```cron
0 */2 9-22 * * /path/to/kt-harvest run >> ~/.kt-harvest/harvest.log 2>&1
```

Can also be run manually: `kt-harvest run` or `kt-harvest run --reprocess`

## Implementation Language

Node.js — kt is already Node, Ollama has a JS client, and the core complexity is JSON parsing (LLM output → kt capture commands). Shell scripting would work for orchestration but breaks down at structured JSON handling.

## Alternative Path: Claude Code CLI

Documented but not built first. If local model quality proves insufficient:

Replace the Ollama extraction step with:
```bash
echo "<transcript + protocol>" | claude -p
```

This uses the Claude Max plan allocation (zero marginal API cost). Same protocol, same pipeline, higher quality judgment. The switch is a one-line change in the extraction function.

## Dependencies

- ccvault (installed via Homebrew, `ccvault` binary)
- kt (existing, `kt` binary)
- Ollama (existing on Mac Mini, models on /Volumes/Storage/)
- Node.js 18+ (existing)

## Risk & Mitigation

| Risk | Mitigation |
|------|------------|
| Local model produces too much noise | Precision-weighted evaluation; Claude Code CLI fallback |
| Long sessions exceed context window | Pre-processing strips tool output; truncation strategy |
| Ollama down or busy | Session stays unprocessed, picked up next run |
| Duplicate nodes from reprocessing | kt's built-in dedup detection |
| Protocol drift (rules don't match reality over time) | Protocol is a versioned markdown file; periodic review like any other protocol. Three-agent architecture allows targeted fixes to the failing agent. |
| Claude Code auto-compaction destroys mid-session context | Raw JSONL in ~/.claude/projects/ is the complete record. ccvault indexes these files, not the compacted session. This is a core motivation for building kt-harvest. |
