import { getDatabase } from '../db/connection.js';
import type { Node } from './nodes.js';

interface SearchOptions {
  namespace?: string;
  limit?: number;
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

  if (options.namespace) {
    conditions.push('namespace = ?');
    params.push(options.namespace);
  }

  const limit = options.limit || 20;
  const where = `WHERE ${conditions.join(' AND ')}`;

  const rows = db.prepare(
    `SELECT * FROM nodes ${where} ORDER BY updated_at DESC LIMIT ?`
  ).all(...params, limit);

  return rows.map(rowToNode);
}
