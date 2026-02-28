import { Command } from 'commander';
import { searchNodes, semanticSearch } from '../../core/search.js';
import { generateEmbedding } from '../../core/embeddings.js';
import { getPendingEmbeddings, markEmbeddingDone } from '../../core/nodes.js';
import { insertEmbedding } from '../../db/vec.js';
import { formatNodeList, detectFormat, type Format } from '../format.js';

async function flushPendingEmbeddings(): Promise<number> {
  const pending = getPendingEmbeddings(10);
  if (pending.length === 0) return 0;

  let flushed = 0;
  for (const node of pending) {
    const text = node.title ? `${node.title}\n${node.content}` : node.content;
    const embedding = await generateEmbedding(text);
    if (embedding) {
      insertEmbedding(node.id, embedding);
      markEmbeddingDone(node.id);
      flushed++;
    } else {
      break;
    }
  }
  return flushed;
}

export function searchCommand(): Command {
  return new Command('search')
    .description('Search knowledge nodes')
    .argument('<query>', 'Search query')
    .option('-n, --namespace <ns>', 'Filter by namespace')
    .option('-k, --limit <number>', 'Max results', '10')
    .option('-f, --format <fmt>', 'Output format (json|human|brief)')
    .option('--keyword', 'Force keyword search (skip semantic)')
    .action(async (query, options) => {
      const limit = parseInt(options.limit);
      const format: Format = options.format || detectFormat(Boolean(process.stdout.isTTY));

      let results;

      if (!options.keyword) {
        // Try semantic search first
        const embedding = await generateEmbedding(query);
        if (embedding) {
          // Opportunistically embed pending nodes while Ollama is hot
          const flushed = await flushPendingEmbeddings();
          if (flushed > 0) {
            process.stderr.write(`(embedded ${flushed} pending node${flushed > 1 ? 's' : ''})\n`);
          }

          results = semanticSearch(embedding, {
            namespace: options.namespace,
            limit,
          });
        }
      }

      // Fall back to keyword search
      if (!results || results.length === 0) {
        results = searchNodes(query, {
          namespace: options.namespace,
          limit,
        });
      }

      console.log(formatNodeList(results, format));
    });
}
