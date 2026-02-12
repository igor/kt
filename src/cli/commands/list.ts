import { Command } from 'commander';
import { listNodes } from '../../core/nodes.js';
import { formatNodeList, detectFormat, type Format } from '../format.js';

export function listCommand(): Command {
  return new Command('list')
    .description('List knowledge nodes')
    .option('-n, --namespace <ns>', 'Filter by namespace')
    .option('-s, --status <status>', 'Filter by status (active, stale, compacted)')
    .option('-k, --limit <number>', 'Max results')
    .option('-f, --format <fmt>', 'Output format')
    .action((options) => {
      const nodes = listNodes({
        namespace: options.namespace,
        status: options.status,
        limit: options.limit ? parseInt(options.limit) : undefined,
        includeCompacted: options.status === 'compacted',
      });
      const format: Format = options.format || detectFormat(Boolean(process.stdout.isTTY));
      console.log(formatNodeList(nodes, format));
    });
}
