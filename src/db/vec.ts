import { getDatabase } from './connection.js';

export interface SimilarResult {
  node_id: string;
  distance: number;
}

export function insertEmbedding(nodeId: string, embedding: Float32Array): void {
  const db = getDatabase();
  const buf = Buffer.from(embedding.buffer);
  // Delete first to avoid UNIQUE constraint issues with vec0 virtual table
  db.prepare('DELETE FROM node_embeddings WHERE node_id = ?').run(nodeId);
  db.prepare('INSERT INTO node_embeddings (node_id, embedding) VALUES (?, ?)').run(
    nodeId,
    buf,
  );
}

export function deleteEmbedding(nodeId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM node_embeddings WHERE node_id = ?').run(nodeId);
}

export function searchSimilar(
  queryEmbedding: Float32Array,
  limit: number = 5,
): SimilarResult[] {
  const db = getDatabase();
  const buf = Buffer.from(queryEmbedding.buffer);

  const rows = db.prepare(`
    SELECT node_id, distance
    FROM node_embeddings
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT ?
  `).all(buf, limit);

  return rows as SimilarResult[];
}
