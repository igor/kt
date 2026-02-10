import { Command } from 'commander';
import { listNodes } from '../../core/nodes.js';
import { formatNodeList, detectFormat, type Format } from '../format.js';

export function staleCommand(): Command {
  return new Command('stale')
    .description('List stale knowledge nodes')
    .option('-n, --namespace <ns>', 'Filter by namespace')
    .option('-f, --format <fmt>', 'Output format')
    .action((options) => {
      const nodes = listNodes({ status: 'stale', namespace: options.namespace });
      const format: Format = options.format || detectFormat(Boolean(process.stdout.isTTY));
      console.log(formatNodeList(nodes, format));
    });
}
