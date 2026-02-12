# The Digest as Menu: How AI Reads Knowledge So You Don't Have To

## The Problem With Knowledge Retrieval

Traditional knowledge management gives you two modes: **search** (pull exactly what you asked for) and **browse** (scroll through everything). Both assume the human does the reading.

This works when knowledge lives in documents you authored. It breaks when knowledge is captured in fragments — dozens of nodes, each a decision or insight, accumulated across work sessions. Nobody wants to read 12 nodes to remember where a project stands. And nobody should have to.

## What kt's Digest Does

Type `kt` in a project directory. Instead of a list of nodes, you get a synthesized briefing:

```
### Summary
A product strategy project exploring pricing models and launch timing.
Recent work focused on tier structure, competitive positioning, and
pilot partner selection.

### Key Topics

**Pricing Architecture**
Two-tier model: Pro ($49/mo) and Enterprise (custom). Decided against
a free tier — conversion rates don't justify support costs at current
scale.

**Competitive Positioning**
Three direct competitors identified. Differentiator is the integration
story, not features. Sales deck should lead with workflow, not specs.

**Pilot Program**
Two partners confirmed for Q2. Third still in legal review. Risk:
partner B wants custom SLA terms that could set precedent.

### Decisions & Rationale
- No free tier — support costs outweigh conversion at current scale.
- Lead with workflow not features — competitors match on specs.

### Open Threads
- Partner B's custom SLA request — need to decide if this sets
  precedent before signing.

Pick a topic to work on.
```

Twelve nodes became five paragraphs. The structure (Key Topics, Decisions, Open Threads) gives you the shape of the knowledge without the weight of reading everything.

## The Menu Pattern

Here's the idea that emerged from using this: **the digest isn't a document to read — it's a menu to choose from.**

The interaction goes:

1. `/kt` → Claude produces the briefing
2. You scan it — takes 15 seconds
3. You say: "let's work on the pilot program"
4. Claude loads the relevant nodes **into its own context** — you never see them
5. Claude confirms: "Loaded the pilot context — 3 nodes covering partner status, SLA negotiations, and timeline risks. What do you want to do with it?"
6. You work together: draft an email, refine the SLA position, whatever

The key move: **Claude reads the knowledge on your behalf.** You don't look up node IDs. You don't read raw content. You point at a topic and Claude equips itself to collaborate with you on it.

This is different from both retrieval (where you read what comes back) and RAG (where the system silently injects context). Here, the human sees the shape of available knowledge, makes a deliberate choice about what to activate, and then the AI loads it. The human stays in control of scope without doing the reading work.

## Why This Matters

### For knowledge systems

Most knowledge tools optimize for storage and retrieval. But the bottleneck isn't finding information — it's the cognitive cost of reloading context. Every time you switch tasks or return to a project after a break, you pay a "context tax" reading yourself back in.

The digest pattern collapses that tax. The briefing gives you the map. Picking a topic gives Claude the territory. You skip straight to productive work.

### For AI interaction patterns

There's an emerging pattern here that goes beyond knowledge management: **AI as a context-loading intermediary.**

The human decides WHAT to focus on. The AI handles the HOW of loading and synthesizing the relevant material. Neither is in full control — the human steers, the AI reads.

This sits between two extremes:
- **Full autonomy** (AI decides what's relevant, injects it silently) — you lose control of scope
- **Manual retrieval** (human reads everything, decides what matters) — you waste time

The menu pattern gives you scope control without the reading cost.

### For team knowledge

When knowledge isn't in one person's head but distributed across captured nodes, the digest becomes a shared entry point. Two people looking at the same digest see the same structure. One says "I'll take pricing, you take the pilot" — and each gets Claude loaded with the right context for their thread.

## How It Works Technically

The digest is cached per namespace, keyed by a hash of node IDs and timestamps. If nothing changed since last time, you get the cached version instantly. New captures or updates invalidate the cache automatically.

```
kt (no args)
  → resolve namespace from cwd
  → hash recent nodes
  → cache hit? → serve cached digest
  → cache miss? → Claude synthesizes → cache + serve
```

The synthesis prompt instructs Claude to group by theme (not chronologically), preserve decisions and their rationale, and surface contradictions. The cache means you only pay for an API call when knowledge actually changes.

## Open Questions

- **How stale is too stale?** The default time window is 2 days. For a fast-moving project that's right; for a slow-burn strategic engagement, 30 days might be better. Should the window be configurable per namespace?
- **Multi-namespace digests?** Sometimes you want to see across projects. A "weekly across everything" digest could be interesting.
- **Digest diffs?** "What changed since last time I looked" — highlighting new knowledge against the previous digest.
- **Team digests?** If multiple people capture knowledge in the same namespace, the digest becomes a shared briefing. What conventions make this work?
