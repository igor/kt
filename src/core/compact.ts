import { getDatabase } from '../db/connection.js';
import { createNode, getNode, updateNodeStatus, type Node } from './nodes.js';
import { detectClusters, type Cluster } from './clustering.js';
import { summarizeCluster } from './summarize.js';
import { generateEmbedding } from './embeddings.js';
import { insertEmbedding } from '../db/vec.js';
import { markEmbeddingDone } from './nodes.js';

export interface CompactionPlan {
  clusters: Cluster[];
  totalNodes: number;
}

export interface CompactionResult {
  summaryNode: Node;
  compactedIds: string[];
}

interface CompactionOptions {
  namespace?: string;
  minClusterSize?: number;
  semanticThreshold?: number;
}

export function dryRunCompaction(options: CompactionOptions = {}): CompactionPlan {
  const clusters = detectClusters({
    namespace: options.namespace,
    minClusterSize: options.minClusterSize ?? 3,
    semanticThreshold: options.semanticThreshold,
  });

  const totalNodes = clusters.reduce((sum, c) => sum + c.nodeIds.length, 0);

  return { clusters, totalNodes };
}

export async function compactCluster(cluster: Cluster): Promise<CompactionResult | null> {
  const db = getDatabase();

  // Load full nodes
  const nodes: Node[] = [];
  for (const id of cluster.nodeIds) {
    const node = getNode(id);
    if (node) nodes.push(node);
  }

  if (nodes.length === 0) return null;

  // Generate summary via Claude
  const summaryContent = await summarizeCluster(nodes);
  if (!summaryContent) return null;

  // Derive title from the cluster
  const titles = nodes.map(n => n.title).filter(Boolean);
  const summaryTitle = titles.length > 0
    ? `Compacted: ${titles.slice(0, 3).join(', ')}${titles.length > 3 ? '...' : ''}`
    : `Compacted ${nodes.length} nodes`;

  // Collect all tags from originals
  const allTags = new Set<string>();
  for (const node of nodes) {
    if (node.tags) node.tags.forEach(t => allTags.add(t));
  }

  // Create summary node
  const summaryNode = createNode({
    namespace: cluster.namespace,
    content: summaryContent,
    title: summaryTitle,
    tags: allTags.size > 0 ? [...allTags] : undefined,
    source_type: 'compaction',
  });

  // Generate embedding for summary
  const embedding = await generateEmbedding(
    summaryTitle + '\n' + summaryContent
  );
  if (embedding) {
    insertEmbedding(summaryNode.id, embedding);
    markEmbeddingDone(summaryNode.id);
  }

  // Re-point inbound links from originals to summary
  const originalIds = cluster.nodeIds;
  const placeholders = originalIds.map(() => '?').join(',');

  // Find links from outside the cluster pointing to nodes inside the cluster
  db.prepare(`
    UPDATE links SET target_id = ?
    WHERE target_id IN (${placeholders})
    AND source_id NOT IN (${placeholders})
  `).run(summaryNode.id, ...originalIds, ...originalIds);

  // Mark originals as compacted
  for (const id of originalIds) {
    updateNodeStatus(id, 'compacted');
    db.prepare('UPDATE nodes SET compacted_into = ? WHERE id = ?').run(summaryNode.id, id);
  }

  // Delete internal links (links between compacted nodes)
  db.prepare(`
    DELETE FROM links
    WHERE source_id IN (${placeholders}) AND target_id IN (${placeholders})
  `).run(...originalIds, ...originalIds);

  return {
    summaryNode,
    compactedIds: originalIds,
  };
}
