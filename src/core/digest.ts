import crypto from 'crypto';
import { getDatabase } from '../db/connection.js';
import type { Node } from './nodes.js';
import type { Link } from './links.js';

export function computeNodeHash(nodes: Node[]): string {
  if (nodes.length === 0) return '';
  const data = nodes
    .map(n => `${n.id}:${n.updated_at}`)
    .sort()
    .join('|');
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
}

export function getCachedDigest(namespace: string, nodeHash: string, days: number): string | null {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT content FROM digests WHERE namespace = ? AND node_hash = ? AND days = ?'
  ).get(namespace, nodeHash, days) as { content: string } | undefined;
  return row?.content ?? null;
}

export function cacheDigest(namespace: string, content: string, nodeHash: string, days: number): void {
  const db = getDatabase();
  db.prepare(`
    INSERT OR REPLACE INTO digests (namespace, content, generated_at, node_hash, days)
    VALUES (?, ?, datetime('now'), ?, ?)
  `).run(namespace, content, nodeHash, days);
}

export function buildDigestPrompt(
  nodes: Node[],
  links: Link[],
  claudeMdContent: string | null,
): string {
  const sorted = [...nodes].sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  );

  const nodeDescriptions = sorted.map(n => {
    const title = n.title ? `**${n.title}**` : '(untitled)';
    const tags = n.tags ? ` [tags: ${n.tags.join(', ')}]` : '';
    return `### ${n.id}: ${title}${tags}\nCaptured: ${n.created_at}\n\n${n.content}`;
  }).join('\n\n');

  const linkDescriptions = links.length > 0
    ? `\n## Relationships Between Nodes\n\n${links.map(l =>
        `- ${l.source_id} **${l.link_type}** ${l.target_id}${l.context ? ` — ${l.context}` : ''}`
      ).join('\n')}\n`
    : '';

  const claudeMdSection = claudeMdContent
    ? `\n## Project Context (from CLAUDE.md)\n\n${claudeMdContent}\n`
    : '';

  return `You are generating a knowledge digest — a structured briefing of recent knowledge captured in a project namespace.

Your job is to synthesize the nodes below into a coherent, readable briefing that helps someone quickly understand what's been happening.
${claudeMdSection}
## Recent Knowledge Nodes

${nodeDescriptions}
${linkDescriptions}
## Output Format

Produce a markdown briefing with these sections. Omit any section that has no relevant content.

### Summary
2-3 sentences: what is this namespace about and what has been happening recently.

### Key Topics
Group knowledge by theme (not chronologically). Each topic gets a short paragraph describing the current state of knowledge.

### Decisions & Rationale
Any decisions captured, with their reasoning. Preserve the "why" — this is the most valuable part.

### Open Threads
Things that feel unresolved: contradictions between nodes, stale knowledge that may need updating, questions without clear answers.

### Alerts
Conflicts or stale knowledge that needs attention. Only include if present.

## Rules

- Be concise — this is a briefing, not a report
- Preserve specifics: names, numbers, dates, technical choices
- Group by theme, not by date
- If nodes contradict each other, surface this in Open Threads
- Do NOT add your own analysis or recommendations — just synthesize what's captured
- Output ONLY the briefing markdown, no preamble`;
}
