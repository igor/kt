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
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌────────┐
│ ccvault sync │ ──▶ │ kt-harvest   │ ──▶ │ Ollama LLM  │ ──▶ │ kt     │
│ (index new)  │     │ (orchestrator)│     │ (extraction) │     │capture │
└─────────────┘     └──────────────┘     └─────────────┘     └────────┘
```

**ccvault** (external, not forked): Parses raw Claude Code JSONL session files into a searchable SQLite database. Provides CLI for listing sessions, exporting transcripts, and searching. Maintained upstream at github.com/2389-research/ccvault.

**kt-harvest** (new, this project): Orchestration script that bridges ccvault and kt. Reads unprocessed sessions from ccvault, sends them through a local LLM with the capture protocol, and pipes extracted nodes into `kt capture`.

**Ollama** (existing infrastructure): Runs on Mac Mini. Already serves `nomic-embed-text` for kt embeddings. Will additionally run an instruction-following model for extraction.

**kt** (existing): Receives nodes via `kt capture`. Handles dedup detection, auto-linking, namespace routing, and eventual compaction via `/kompact`.

## The Capture Protocol

A markdown file that serves as the system prompt for every extraction run. Single source of truth for "what's worth keeping."

### Golden Principles

1. **Capture decisions, not actions.** "We chose X because Y" is knowledge. "We ran the build" is not.
2. **Capture rationale, not just outcomes.** The "why" compounds. The "what" is in git.
3. **Capture contradictions.** When reality contradicted an assumption — high-value.
4. **Capture framework refinements.** When a model/approach got sharpened through use.
5. **Skip mechanical execution.** Debugging loops, CSS fixes, "run the tests" — process, not knowledge.

**Meta-principle:** When in doubt, don't capture. `/kompact` handles cleanup, but noise is harder to clean than gaps.

### Node Type Taxonomy

| Type | Trigger | Example |
|------|---------|---------|
| Decision | A choice was made with stated reasoning | "Chose ccvault over forking because upstream is actively maintained" |
| Contradiction | Something believed turned out wrong | "Assumed 16GB RAM on Mac Mini, actually 24GB — opens up larger models" |
| Insight | A pattern, connection, or reframe emerged | "Strategy-as-Protocol logic applies to knowledge capture itself" |
| Context | Client preferences, project constraints, domain knowledge | "Mac Mini Ollama models must be stored on /Volumes/Storage" |
| Refinement | An existing framework/approach was improved | "Kompact staleness threshold adjusted from 60 to 30 days for active projects" |

The protocol file will include 2-3 real examples per type, drawn from existing kt nodes.

### Expected Output Format

The LLM returns structured JSON:

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

Or an empty array `[]` for sessions with nothing worth capturing.

## Pipeline Details

### Orchestration Flow

1. Run `ccvault sync` to pick up new/updated sessions
2. Get list of all sessions from ccvault (`ccvault list-sessions --json`)
3. Filter against processed sessions list (stored in `~/.kt-harvest/state.json`)
4. For each unprocessed session:
   a. Export transcript: `ccvault export <session-id>`
   b. Pre-process: truncate tool output blocks, keep human/assistant dialogue (decisions live in the conversation, not in `cat` output)
   c. Send to Ollama with capture protocol as system prompt
   d. Parse JSON response
   e. For each extracted node: `kt capture "<content>" --namespace <ns> --title "<title>" --tags "<tags>"`
   f. Mark session as processed in state file
5. Log summary

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
- If still too long, keep first 30% and last 30% of turns (decisions cluster at the start and end of work sessions)

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
| Protocol drift (rules don't match reality over time) | Protocol is a versioned markdown file; periodic review like any other protocol |
