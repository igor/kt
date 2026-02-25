---
name: daily-kapture
description: Review recent Claude Code sessions and catch uncaptured knowledge. Safety net for sessions where /kapture wasn't run.
user-invocable: true
---

# Daily KT Review

Safety net for catching knowledge that fell through the cracks. This does NOT replace in-session `/kapture` — it catches sessions where you forgot, and surfaces them for your judgment.

**Core principle:** You decide what matters. This skill facilitates, never autonomously captures.

## Process

### 1. Determine time window

```bash
cat ~/.claude/last-kapture 2>/dev/null || echo "0"
```

- If the file exists: review window = last-kapture timestamp → now
- If missing or 0: default to last 24 hours

Convert the Unix timestamp to a human-readable date to tell the user what period you're reviewing.

### 2. List and summarize sessions

Call `mcp__ccvault__list_sessions` with `limit: 30`.

Filter to sessions updated after the last-kapture timestamp. If none, report "Nothing new since [date]", update timestamp, stop.

For each session in the window, call `mcp__ccvault__get_session_summary` to get:
- Project/working directory
- Turn count and tools used
- First and last messages (to understand the topic)

Auto-exclude noise: sessions with fewer than 5 turns, pure file reads/edits with no discussion.

### 3. Detect already-captured sessions

For each remaining session, call `mcp__ccvault__get_turns` with `limit: 50, type: "assistant"` and scan for `kt capture` commands in tool use. If found, mark the session as **"already captured"**.

### 4. Present session inventory (Pass 1)

Show a one-line-per-session inventory. Include project, topic summary, turn count, duration, and capture status:

```
5 sessions since last review (Feb 24 09:00):

1. [kt] Fix auto-link self-referencing bug (42 turns, 2h)
2. [ep-advisory] Pricing model discussion (28 turns, 1.5h) — already captured
3. [dotfiles] zsh config tweak (8 turns, 15min)
4. [kt] Daily-kapture redesign (35 turns, 1h)
5. [oio-google] Workshop prep call notes (22 turns, 45min)
```

Then ask which sessions are worth reviewing deeper:

**2–4 sessions:** Use `AskUserQuestion` with `multiSelect: true`. One option per session, plus "All sessions". The built-in "Other" field lets the user add notes.

**5+ sessions:** Prompt:
> `all` · `1 4 5` · `n` — which to review?

Parse: `y`/`all`/`a` = all sessions · numbers (space or comma separated) = those sessions · `n`/`none`/`skip` = nothing, update timestamp and stop.

"Already captured" sessions should still be selectable — the user might want to add something the in-session capture missed.

### 5. Deep review selected sessions (Pass 2)

For each selected session:

1. Call `mcp__ccvault__get_turns` with `limit: 50` (both user and assistant turns)
2. Find **decision moments** — places where alternatives were weighed, trade-offs discussed, choices made, or new context was established
3. For each proposed capture, present it alongside the **source evidence**:

```
Session 1: Fix auto-link self-referencing bug

  > "searchNodes() keyword fallback wasn't receiving excludeIds,
  >  so new nodes matched their own content during auto-linking"
  > — turn 14

  Proposed: **auto-link self-referencing bug root cause**
  searchNodes() keyword fallback didn't pass excludeIds, causing new
  nodes to match themselves. Fixed by threading excludeIds through
  keyword search + defensive guard in createLink().
  ns: kt · tags: bug-fix, auto-link, search
```

Present all proposed captures from a session together, then use the selection UX:

**2–4 captures:** Use `AskUserQuestion` with `multiSelect: true`. One option per capture, plus "All captures".

**5+ captures:** Prompt:
> `all` · `1 3` · `n` — which to capture?

If the user selects "Other" or types custom text, treat it as an edit instruction for the proposed captures.

### 6. Capture approved items

For each approved capture:

```bash
kt capture "<content>" --namespace <ns> --title "<title>" --tags "<tag1,tag2,tag3>"
```

Infer namespace from the session's working directory:
- GitHub project paths → check if a matching kt namespace exists
- When ambiguous → default to `default`, or ask user

Content must be self-contained — readable without session context. Write as a fact or decision, not a process note.

Report what was captured: node IDs, any auto-links created, any similar existing nodes found.

### 7. Update timestamp

Always update the timestamp after running, whether or not anything was captured:

```bash
date +%s > ~/.claude/last-kapture
```

### 8. Repeat for next session

If multiple sessions were selected in Pass 1, proceed to the next one. Do NOT batch captures across sessions — review and capture one session at a time so the user stays oriented.

## Guidelines

- **Safety net, not primary path** — this catches what /kapture missed, not replaces it
- **User decides what matters** — never capture without explicit approval
- **Show source evidence** — every proposed capture includes the conversation excerpt it came from
- **No cross-session synthesis** — each capture traces to exactly one session. Do not merge themes across sessions.
- **"Nothing to capture" is a valid outcome** — handle it gracefully, update timestamp, done
- **Self-contained captures** — each node readable without session context
- **Decisions + rationale** over process notes ("Chose X because Y", not "We discussed X")
- **One session at a time** — don't overwhelm with all captures from all sessions at once

## Example

```
User: /daily-kapture

Claude: Reviewing since Feb 24 09:00 (22h, 4 sessions):

1. [kt] Fix auto-link self-referencing bug (42 turns, 2h)
2. [ep-advisory] Pricing model discussion (28 turns, 1.5h) — already captured
3. [dotfiles] zsh config tweak (8 turns, 15min)
4. [kt] Skill selection UX standardization (18 turns, 30min)

→ [AskUserQuestion multiSelect: "1. auto-link bug", "3. zsh config", "4. skill UX", "All sessions"]

User: [selects 1, 4]

Claude: **Session 1: Fix auto-link self-referencing bug**

  > "searchNodes() keyword fallback wasn't receiving excludeIds,
  >  so new nodes matched their own content during auto-linking"
  > — turn 14

  Proposed: **auto-link self-referencing bug root cause**
  searchNodes() keyword fallback didn't pass excludeIds, causing new
  nodes to match themselves. Fixed by threading excludeIds + guard
  in createLink() rejecting sourceId === targetId.
  ns: kt · tags: bug-fix, auto-link, search

→ [AskUserQuestion multiSelect: "Capture as-is", "Skip"]

User: [Capture as-is]

Claude: [runs kt capture]
Captured: kt-ab12 "auto-link self-referencing bug root cause" (kt)
  → Auto-linked to kt-d7eb39

Now reviewing session 4...

[continues with session 4]

Timestamp updated. Done.
```
