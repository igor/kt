import { getDatabase } from '../db/connection.js';
import { searchSimilar } from '../db/vec.js';
import { namespaceFilter } from './namespace-filter.js';

export interface Cluster {
  nodeIds: string[];
  namespace: string;
}

interface DetectClustersOptions {
  namespace?: string;
  minClusterSize?: number;
  semanticThreshold?: number;
}

export function detectClusters(options: DetectClustersOptions = {}): Cluster[] {
  const db = getDatabase();
  const minSize = options.minClusterSize ?? 3;
  const semanticThreshold = options.semanticThreshold ?? 0.8;

  // Get all stale nodes in the namespace
  const conditions: string[] = ["status = 'stale'"];
  const params: any[] = [];

  const nsFilter = namespaceFilter(options.namespace);
  if (nsFilter) {
    conditions.push(nsFilter.sql);
    params.push(...nsFilter.params);
  }

  const staleNodes = db.prepare(
    `SELECT id, namespace FROM nodes WHERE ${conditions.join(' AND ')}`
  ).all(...params) as { id: string; namespace: string }[];

  if (staleNodes.length === 0) return [];

  const staleIds = new Set(staleNodes.map(n => n.id));

  // Build adjacency from links between stale nodes
  const adjacency = new Map<string, Set<string>>();
  for (const node of staleNodes) {
    adjacency.set(node.id, new Set());
  }

  // Get all links between stale nodes
  const placeholders = staleNodes.map(() => '?').join(',');
  const links = db.prepare(`
    SELECT source_id, target_id FROM links
    WHERE source_id IN (${placeholders}) AND target_id IN (${placeholders})
  `).all(...[...staleIds], ...[...staleIds]) as { source_id: string; target_id: string }[];

  for (const link of links) {
    adjacency.get(link.source_id)?.add(link.target_id);
    adjacency.get(link.target_id)?.add(link.source_id);
  }

  // Add semantic similarity edges
  // For each stale node with an embedding, find similar stale nodes
  for (const node of staleNodes) {
    try {
      const row = db.prepare('SELECT embedding FROM node_embeddings WHERE node_id = ?').get(node.id) as { embedding: Buffer } | undefined;
      if (!row) continue;

      const embedding = new Float32Array(row.embedding.buffer.slice(
        row.embedding.byteOffset,
        row.embedding.byteOffset + row.embedding.byteLength,
      ));

      const similar = searchSimilar(embedding, 10);
      for (const s of similar) {
        if (s.node_id !== node.id && staleIds.has(s.node_id) && s.distance < semanticThreshold) {
          adjacency.get(node.id)?.add(s.node_id);
          adjacency.get(s.node_id)?.add(node.id);
        }
      }
    } catch {
      // Skip nodes without embeddings
    }
  }

  // Find connected components via BFS
  const visited = new Set<string>();
  const clusters: Cluster[] = [];

  for (const node of staleNodes) {
    if (visited.has(node.id)) continue;

    const component: string[] = [];
    const queue: string[] = [node.id];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      component.push(current);

      const neighbors = adjacency.get(current);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            queue.push(neighbor);
          }
        }
      }
    }

    if (component.length >= minSize) {
      clusters.push({
        nodeIds: component,
        namespace: node.namespace,
      });
    }
  }

  return clusters;
}
