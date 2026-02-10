import { Command } from 'commander';
import { searchNodes } from '../../core/search.js';
import { formatNodeList, detectFormat, type Format } from '../format.js';

export function searchCommand(): Command {
  return new Command('search')
    .description('Search knowledge nodes')
    .argument('<query>', 'Search query')
    .option('-n, --namespace <ns>', 'Filter by namespace')
    .option('-k, --limit <number>', 'Max results', '10')
    .option('-f, --format <fmt>', 'Output format (json|human|brief)')
    .action((query, options) => {
      const results = searchNodes(query, {
        namespace: options.namespace,
        limit: parseInt(options.limit),
      });

      const format: Format = options.format || detectFormat(Boolean(process.stdout.isTTY));
      console.log(formatNodeList(results, format));
    });
}
