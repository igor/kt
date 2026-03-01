import { getDatabase } from '../db/connection.js';
import type { Node } from './nodes.js';
import { searchSimilar } from '../db/vec.js';
import { namespaceFilter } from './namespace-filter.js';

interface SearchOptions {
  namespace?: string;
  limit?: number;
  excludeIds?: string[];
}

function rowToNode(row: any): Node {
  return {
    ...row,
    tags: row.tags ? JSON.parse(row.tags) : null,
    embedding_pending: Boolean(row.embedding_pending),
  };
}

export function searchNodes(query: string, options: SearchOptions = {}): Node[] {
  const db = getDatabase();
  const conditions: string[] = [
    "status != 'compacted'",
    "(title LIKE ? COLLATE NOCASE OR content LIKE ? COLLATE NOCASE)",
  ];
  const params: any[] = [`%${query}%`, `%${query}%`];

  const nsFilter = namespaceFilter(options.namespace);
  if (nsFilter) {
    conditions.push(nsFilter.sql);
    params.push(...nsFilter.params);
  }

  if (options.excludeIds && options.excludeIds.length > 0) {
    const exPlaceholders = options.excludeIds.map(() => '?').join(',');
    conditions.push(`id NOT IN (${exPlaceholders})`);
    params.push(...options.excludeIds);
  }

  const limit = options.limit || 20;
  const where = `WHERE ${conditions.join(' AND ')}`;

  const rows = db.prepare(
    `SELECT * FROM nodes ${where} ORDER BY updated_at DESC LIMIT ?`
  ).all(...params, limit);

  return rows.map(rowToNode);
}

interface SemanticSearchOptions {
  namespace?: string;
  limit?: number;
  excludeIds?: string[];
}

export function semanticSearch(
  queryEmbedding: Float32Array,
  options: SemanticSearchOptions = {},
): Node[] {
  const limit = options.limit || 10;

  // Get candidates from vec search (fetch more than needed to allow filtering)
  const candidates = searchSimilar(queryEmbedding, limit * 3);

  if (candidates.length === 0) return [];

  const db = getDatabase();
  const nodeIds = candidates.map(c => c.node_id);
  const placeholders = nodeIds.map(() => '?').join(',');

  const conditions: string[] = [
    `id IN (${placeholders})`,
    "status != 'compacted'",
  ];
  const params: any[] = [...nodeIds];

  const nsFilter = namespaceFilter(options.namespace);
  if (nsFilter) {
    conditions.push(nsFilter.sql);
    params.push(...nsFilter.params);
  }

  if (options.excludeIds && options.excludeIds.length > 0) {
    const exPlaceholders = options.excludeIds.map(() => '?').join(',');
    conditions.push(`id NOT IN (${exPlaceholders})`);
    params.push(...options.excludeIds);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const rows = db.prepare(`SELECT * FROM nodes ${where}`).all(...params);

  // Preserve the similarity ordering from vec search
  const nodeMap = new Map(rows.map(r => [(r as any).id, r]));
  const ordered = nodeIds
    .filter(id => nodeMap.has(id))
    .map(id => rowToNode(nodeMap.get(id)))
    .slice(0, limit);

  return ordered;
}
