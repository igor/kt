import { searchNodes } from '../core/search.js';
import { captureWithIntelligence } from '../core/capture.js';
import { getNode } from '../core/nodes.js';
import { listNamespaces } from '../core/namespaces.js';
import { getLinks } from '../core/links.js';
import { getDatabase } from '../db/connection.js';

// Types matching MCP tool result format
interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}

// --- Tool Handlers ---

export function handleSearch(params: { query: string; namespace?: string; limit?: number }): ToolResult {
  const nodes = searchNodes(params.query, {
    namespace: params.namespace,
    limit: params.limit ?? 10,
  });
  return jsonResult({
    results: nodes.map(n => ({
      id: n.id,
      title: n.title,
      namespace: n.namespace,
      content: n.content.substring(0, 300),
      status: n.status,
      updated_at: n.updated_at,
    })),
  });
}

export function handleCapture(params: { content: string; title?: string; namespace?: string; tags?: string[] }): ToolResult {
  const namespace = params.namespace || 'default';
  const result = captureWithIntelligence({
    namespace,
    content: params.content,
    title: params.title,
    tags: params.tags,
    embedding: null,
    autoLink: true,
  });
  return jsonResult({
    node: {
      id: result.node.id,
      title: result.node.title,
      namespace: result.node.namespace,
      content: result.node.content,
      created_at: result.node.created_at,
    },
    similar: result.similar.map(n => ({ id: n.id, title: n.title })),
    auto_linked: result.autoLinked,
  });
}

export function handleContext(params: { namespace?: string; limit?: number }): ToolResult {
  const namespace = params.namespace || 'default';
  const db = getDatabase();
  const limit = params.limit ?? 5;

  const nodes = db.prepare(
    `SELECT * FROM nodes WHERE namespace = ? AND status = 'active' ORDER BY updated_at DESC LIMIT ?`
  ).all(namespace, limit) as any[];

  const conflicts = db.prepare(
    `SELECT l.source_id as node_a, l.target_id as node_b, l.context as description
     FROM links l
     JOIN nodes n1 ON l.source_id = n1.id
     JOIN nodes n2 ON l.target_id = n2.id
     WHERE l.link_type = 'contradicts'
     AND n1.namespace = ? AND n1.status = 'active'
     AND n2.status = 'active'`
  ).all(namespace) as any[];

  const staleNodes = db.prepare(
    `SELECT id, title, stale_at FROM nodes WHERE namespace = ? AND status = 'stale' ORDER BY stale_at DESC LIMIT 5`
  ).all(namespace) as any[];

  return jsonResult({
    namespace,
    loaded_at: new Date().toISOString(),
    total_nodes: nodes.length,
    active_nodes: nodes.map((row: any) => ({
      id: row.id,
      title: row.title,
      summary: row.content.substring(0, 200),
      updated_at: row.updated_at,
      links_out: (db.prepare('SELECT COUNT(*) as cnt FROM links WHERE source_id = ?').get(row.id) as any)?.cnt ?? 0,
    })),
    conflicts,
    stale_alerts: staleNodes.map((n: any) => ({
      id: n.id,
      title: n.title,
      stale_since: n.stale_at,
      reason: 'age',
    })),
  });
}

export function handleShow(params: { id: string }): ToolResult {
  const node = getNode(params.id);
  if (!node) return errorResult(`Node ${params.id} not found`);

  const links = getLinks(params.id);
  return jsonResult({ node, links });
}

export function handleListNamespaces(): ToolResult {
  const namespaces = listNamespaces();
  return jsonResult({ namespaces });
}
