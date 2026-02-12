import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { getDatabase } from '../db/connection.js';
import { listNodes } from './nodes.js';
import { getLinks } from './links.js';
import type { Node } from './nodes.js';
import type { Link } from './links.js';

const MODEL = 'claude-sonnet-4-5-20250929';

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

interface DigestOptions {
  days?: number;
  fresh?: boolean;
  projectDir?: string;
}

function getRecentNodes(namespace: string, days: number): Node[] {
  const allNodes = listNodes({ namespace, status: 'active' });
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().replace('T', ' ').substring(0, 19);
  return allNodes.filter(n => n.created_at >= cutoffStr || n.updated_at >= cutoffStr);
}

function getLinksForNodes(nodes: Node[]): Link[] {
  const nodeIds = new Set(nodes.map(n => n.id));
  const allLinks: Link[] = [];
  for (const node of nodes) {
    const links = getLinks(node.id);
    for (const link of links) {
      if (nodeIds.has(link.target_id)) {
        allLinks.push(link);
      }
    }
  }
  return allLinks;
}

function readClaudeMd(projectDir: string | undefined): string | null {
  if (!projectDir) return null;
  const claudeMdPath = path.join(projectDir, '.claude', 'CLAUDE.md');
  try {
    return fs.readFileSync(claudeMdPath, 'utf-8');
  } catch {
    return null;
  }
}

export async function generateDigest(
  namespace: string,
  options: DigestOptions = {},
): Promise<string> {
  const days = options.days ?? 2;

  const recentNodes = getRecentNodes(namespace, days);

  if (recentNodes.length === 0) {
    return `No recent knowledge captured in "${namespace}" (last ${days} day${days === 1 ? '' : 's'}). Use \`kt capture\` to add knowledge.`;
  }

  const nodeHash = computeNodeHash(recentNodes);

  // Check cache (unless --fresh)
  if (!options.fresh) {
    const cached = getCachedDigest(namespace, nodeHash, days);
    if (cached) return cached;
  }

  // Need API key for synthesis
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return 'Error: ANTHROPIC_API_KEY not set. The digest requires Claude to synthesize knowledge.\nSet it with: export ANTHROPIC_API_KEY=your-key';
  }

  const links = getLinksForNodes(recentNodes);
  const claudeMd = readClaudeMd(options.projectDir);
  const prompt = buildDigestPrompt(recentNodes, links, claudeMd);

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = message.content[0];
    if (block.type === 'text') {
      const digest = block.text.trim();
      cacheDigest(namespace, digest, nodeHash, days);
      return digest;
    }

    return 'Error: Unexpected response from Claude.';
  } catch (err) {
    return `Error generating digest: ${err instanceof Error ? err.message : err}`;
  }
}
