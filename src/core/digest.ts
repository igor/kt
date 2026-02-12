import crypto from 'crypto';
import { getDatabase } from '../db/connection.js';
import type { Node } from './nodes.js';

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
