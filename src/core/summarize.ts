import Anthropic from '@anthropic-ai/sdk';
import type { Node } from './nodes.js';

const MODEL = 'claude-sonnet-4-5-20250929';

export function buildCompactionPrompt(nodes: Node[]): string {
  // Sort chronologically
  const sorted = [...nodes].sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  );

  const nodeDescriptions = sorted.map(n => {
    const title = n.title ? `**${n.title}**` : '(untitled)';
    const tags = n.tags ? ` [tags: ${n.tags.join(', ')}]` : '';
    return `### ${n.id}: ${title}${tags}\nCaptured: ${n.created_at}\n\n${n.content}`;
  }).join('\n\n---\n\n');

  return `You are compacting a cluster of related knowledge nodes into a single summary.

These nodes were captured over time and are now being consolidated. Your job is to produce one concise summary that preserves the essential knowledge.

## Rules

- Preserve all **decisions** and their **rationale** (why something was chosen)
- Preserve **current state** (what is true now, not what was true before)
- When nodes contradict each other, keep the **most recent** information
- Drop **outdated details** that have been superseded
- Keep it **concise** — aim for 2-5 sentences that capture the essence
- Do NOT add commentary or analysis — just distill the knowledge
- Output ONLY the summary text, no headers or metadata

## Nodes to Compact

${nodeDescriptions}

## Summary`;
}

export async function summarizeCluster(nodes: Node[]): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }

  try {
    const client = new Anthropic({ apiKey });
    const prompt = buildCompactionPrompt(nodes);

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = message.content[0];
    if (block.type === 'text') {
      return block.text.trim();
    }

    return null;
  } catch (err) {
    console.error('Summarization failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
