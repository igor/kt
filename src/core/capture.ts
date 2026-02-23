import { createNode, markEmbeddingDone, type Node } from './nodes.js';
import { searchNodes, semanticSearch } from './search.js';
import { createLink } from './links.js';
import { insertEmbedding } from '../db/vec.js';

interface FindSimilarOptions {
  namespace?: string;
  keyword?: string;
  limit?: number;
  excludeIds?: string[];
}

interface CaptureInput {
  namespace: string;
  content: string;
  title?: string;
  tags?: string[];
  embedding: Float32Array | null;
  autoLink?: boolean;
  similarityThreshold?: number;
}

interface CaptureResult {
  node: Node;
  similar: Node[];
  autoLinked: string[];
}

const DEFAULT_AUTO_LINK_LIMIT = 3;
const DEFAULT_SIMILARITY_RESULTS = 5;

export function findSimilarNodes(
  embedding: Float32Array | null,
  options: FindSimilarOptions = {},
): Node[] {
  const limit = options.limit || DEFAULT_SIMILARITY_RESULTS;

  // Try semantic search first
  if (embedding) {
    const results = semanticSearch(embedding, {
      namespace: options.namespace,
      limit,
      excludeIds: options.excludeIds,
    });
    if (results.length > 0) return results;
  }

  // Fall back to keyword search
  if (options.keyword) {
    return searchNodes(options.keyword, {
      namespace: options.namespace,
      limit,
      excludeIds: options.excludeIds,
    });
  }

  return [];
}

export function captureWithIntelligence(input: CaptureInput): CaptureResult {
  // Create the node
  const node = createNode({
    namespace: input.namespace,
    content: input.content,
    title: input.title,
    tags: input.tags,
  });

  // Store embedding if available
  if (input.embedding) {
    insertEmbedding(node.id, input.embedding);
    markEmbeddingDone(node.id);
  }

  // Find similar nodes
  const keyword = input.content.split(/\s+/).slice(0, 5).join(' ');
  const similar = findSimilarNodes(input.embedding, {
    namespace: input.namespace,
    keyword,
    excludeIds: [node.id],
  });

  // Auto-link to similar nodes
  const autoLinked: string[] = [];
  if (input.autoLink && similar.length > 0) {
    const linkLimit = Math.min(similar.length, DEFAULT_AUTO_LINK_LIMIT);
    for (let i = 0; i < linkLimit; i++) {
      createLink(node.id, 'related', similar[i].id);
      autoLinked.push(similar[i].id);
    }
  }

  return { node, similar, autoLinked };
}
