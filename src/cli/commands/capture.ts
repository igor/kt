import { Command } from 'commander';
import { captureWithIntelligence } from '../../core/capture.js';
import { generateEmbedding } from '../../core/embeddings.js';
import { ensureNamespace } from '../../core/namespaces.js';
import { resolveNamespace } from '../../core/mappings.js';
import { getVaultRoot } from '../../db/connection.js';
import { formatNodeBrief } from '../format.js';

export function captureCommand(): Command {
  return new Command('capture')
    .description('Capture knowledge')
    .argument('<content>', 'The knowledge to capture')
    .option('-n, --namespace <ns>', 'Namespace')
    .option('-t, --title <title>', 'Title for the node')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--no-link', 'Skip auto-linking')
    .action(async (content, options) => {
      const namespace = options.namespace || resolveNamespace(process.cwd(), getVaultRoot()) || 'default';
      ensureNamespace(namespace);

      const tags = options.tags ? options.tags.split(',').map((t: string) => t.trim()) : undefined;

      // Try to generate embedding (graceful if Ollama is down)
      const text = options.title ? `${options.title}\n${content}` : content;
      const embedding = await generateEmbedding(text);

      const result = captureWithIntelligence({
        namespace,
        content,
        title: options.title,
        tags,
        embedding,
        autoLink: options.link !== false,
      });

      // Output the node ID (primary output for agents)
      console.log(result.node.id);

      // If similar nodes found, mention them (stderr so it doesn't break piping)
      if (result.similar.length > 0) {
        console.error(`\nSimilar existing knowledge:`);
        for (const s of result.similar.slice(0, 3)) {
          console.error(`  ${formatNodeBrief(s)}`);
        }
      }

      if (result.autoLinked.length > 0) {
        console.error(`Auto-linked to ${result.autoLinked.length} related node(s).`);
      }

      if (!embedding) {
        console.error('(Embedding pending — run `kt embed` when Ollama is available)');
      }
    });
}
