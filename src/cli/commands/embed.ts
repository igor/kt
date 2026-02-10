import { Command } from 'commander';
import { getPendingEmbeddings, markEmbeddingDone } from '../../core/nodes.js';
import { generateEmbedding } from '../../core/embeddings.js';
import { insertEmbedding } from '../../db/vec.js';

export function embedCommand(): Command {
  return new Command('embed')
    .description('Generate embeddings for pending nodes')
    .option('-l, --limit <number>', 'Max nodes to process', '50')
    .action(async (options) => {
      const pending = getPendingEmbeddings(parseInt(options.limit));

      if (pending.length === 0) {
        console.log('No pending embeddings.');
        return;
      }

      console.log(`Processing ${pending.length} pending embeddings...`);
      let success = 0;
      let failed = 0;

      for (const node of pending) {
        const text = node.title ? `${node.title}\n${node.content}` : node.content;
        const embedding = await generateEmbedding(text);

        if (embedding) {
          insertEmbedding(node.id, embedding);
          markEmbeddingDone(node.id);
          success++;
          console.log(`  ${node.id} ✓`);
        } else {
          failed++;
          console.log(`  ${node.id} ✗ (Ollama unavailable)`);
          // Stop trying if Ollama is down — no point hitting every node
          if (failed === 1) {
            console.log('Ollama appears unavailable. Stopping.');
            break;
          }
        }
      }

      console.log(`Done: ${success} embedded, ${failed} failed, ${pending.length - success - failed} skipped.`);
    });
}
