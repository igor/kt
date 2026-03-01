import { getDatabase } from '../db/connection.js';
import { generateId } from './ids.js';
import { namespaceFilter } from './namespace-filter.js';

export interface Node {
  id: string;
  namespace: string;
  title: string | null;
  content: string;
  status: 'active' | 'stale' | 'compacted';
  source_type: 'capture' | 'compaction';
  tags: string[] | null;
  embedding_pending: boolean;
  compacted_into: string | null;
  created_at: string;
  updated_at: string;
  stale_at: string | null;
  session_id: string | null;
}

interface CreateNodeInput {
  namespace: string;
  content: string;
  title?: string;
  tags?: string[];
  source_type?: 'capture' | 'compaction';
  session_id?: string;
}

interface ListNodesOptions {
  namespace?: string;
  status?: string;
  includeCompacted?: boolean;
  limit?: number;
}

function rowToNode(row: any): Node {
  return {
    ...row,
    tags: row.tags ? JSON.parse(row.tags) : null,
    embedding_pending: Boolean(row.embedding_pending),
  };
}

export function createNode(input: CreateNodeInput): Node {
  const db = getDatabase();
  const id = generateId(input.content);
  const tags = input.tags ? JSON.stringify(input.tags) : null;

  db.prepare(`
    INSERT INTO nodes (id, namespace, title, content, source_type, tags, embedding_pending, session_id)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    id,
    input.namespace,
    input.title || null,
    input.content,
    input.source_type || 'capture',
    tags,
    input.session_id || null,
  );

  return getNode(id)!;
}

export function getNode(id: string): Node | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
  return row ? rowToNode(row) : null;
}

export function listNodes(options: ListNodesOptions = {}): Node[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: any[] = [];

  const nsFilter = namespaceFilter(options.namespace);
  if (nsFilter) {
    conditions.push(nsFilter.sql);
    params.push(...nsFilter.params);
  }

  if (options.status) {
    conditions.push('status = ?');
    params.push(options.status);
  } else if (!options.includeCompacted) {
    conditions.push("status != 'compacted'");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit ? `LIMIT ${options.limit}` : '';

  const rows = db.prepare(
    `SELECT * FROM nodes ${where} ORDER BY updated_at DESC ${limit}`
  ).all(...params);

  return rows.map(rowToNode);
}

export function updateNodeStatus(id: string, status: 'active' | 'stale' | 'compacted'): void {
  const db = getDatabase();
  const updates: string[] = ['status = ?', "updated_at = datetime('now')"];
  const params: any[] = [status];

  if (status === 'stale') {
    updates.push("stale_at = datetime('now')");
  } else if (status === 'active') {
    updates.push('stale_at = NULL');
  }

  params.push(id);
  db.prepare(`UPDATE nodes SET ${updates.join(', ')} WHERE id = ?`).run(...params);
}

export function deleteNode(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM links WHERE source_id = ? OR target_id = ?').run(id, id);
  db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
}

export function getPendingEmbeddings(limit: number = 50): Node[] {
  const db = getDatabase();
  const rows = db.prepare(
    'SELECT * FROM nodes WHERE embedding_pending = 1 ORDER BY created_at ASC LIMIT ?'
  ).all(limit);
  return rows.map(rowToNode);
}

export function markEmbeddingDone(id: string): void {
  const db = getDatabase();
  db.prepare(
    "UPDATE nodes SET embedding_pending = 0, updated_at = datetime('now') WHERE id = ?"
  ).run(id);
}
