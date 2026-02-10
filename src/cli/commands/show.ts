import { Command } from 'commander';
import { getNode } from '../../core/nodes.js';
import { getLinks } from '../../core/links.js';
import { formatNode, detectFormat, type Format } from '../format.js';

export function showCommand(): Command {
  return new Command('show')
    .description('Show a knowledge node')
    .argument('<id>', 'Node ID')
    .option('-f, --format <fmt>', 'Output format (json|human|brief)')
    .option('--with-links', 'Include outbound links')
    .action((id, options) => {
      const node = getNode(id);
      if (!node) {
        console.error(`Node ${id} not found`);
        process.exit(1);
      }

      const format: Format = options.format || detectFormat(Boolean(process.stdout.isTTY));
      const links = options.withLinks ? getLinks(id) : undefined;
      console.log(formatNode(node, format, links));
    });
}
