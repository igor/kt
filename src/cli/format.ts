import type { Node } from '../core/nodes.js';
import type { Link } from '../core/links.js';

export type Format = 'json' | 'human' | 'brief';

export function detectFormat(isTTY: boolean): Format {
  return isTTY ? 'human' : 'json';
}

export function formatNode(node: Node, format: Format, links?: Link[]): string {
  if (format === 'json') {
    return JSON.stringify(links ? { ...node, links } : node, null, 2);
  }

  if (format === 'brief') {
    return formatNodeBrief(node);
  }

  // Human format
  const lines: string[] = [];
  lines.push(`[${node.id}] ${node.title || '(untitled)'}`);
  lines.push(`  Status: ${node.status}  |  Namespace: ${node.namespace}  |  Updated: ${node.updated_at}`);
  if (node.tags) {
    lines.push(`  Tags: ${node.tags.join(', ')}`);
  }
  lines.push('');
  lines.push(node.content);

  if (links && links.length > 0) {
    lines.push('');
    lines.push('Links:');
    for (const link of links) {
      lines.push(`  ${link.link_type} → ${link.target_id}${link.context ? ` (${link.context})` : ''}`);
    }
  }

  return lines.join('\n');
}

export function formatNodeBrief(node: Node): string {
  const status = node.status === 'active' ? '' : ` [${node.status}]`;
  return `${node.id}  ${node.title || '(untitled)'}${status}  (${node.namespace})`;
}

export function formatNodeList(nodes: Node[], format: Format): string {
  if (format === 'json') {
    return JSON.stringify(nodes, null, 2);
  }

  if (nodes.length === 0) {
    return format === 'human' ? 'No results.' : '';
  }

  return nodes.map(n =>
    format === 'brief' ? formatNodeBrief(n) : formatNode(n, 'human')
  ).join('\n\n');
}
