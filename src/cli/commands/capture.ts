import { Command } from 'commander';
import { createNode } from '../../core/nodes.js';
import { ensureNamespace } from '../../core/namespaces.js';
import { resolveNamespace } from '../../core/mappings.js';

export function captureCommand(): Command {
  return new Command('capture')
    .description('Capture knowledge')
    .argument('<content>', 'The knowledge to capture')
    .option('-n, --namespace <ns>', 'Namespace')
    .option('-t, --title <title>', 'Title for the node')
    .option('--tags <tags>', 'Comma-separated tags')
    .action((content, options) => {
      const namespace = options.namespace || resolveNamespace(process.cwd()) || 'default';
      ensureNamespace(namespace);

      const tags = options.tags ? options.tags.split(',').map((t: string) => t.trim()) : undefined;

      const node = createNode({
        namespace,
        content,
        title: options.title,
        tags,
      });

      console.log(node.id);
    });
}
