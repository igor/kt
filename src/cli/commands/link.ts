import { Command } from 'commander';
import { createLink } from '../../core/links.js';

export function linkCommand(): Command {
  return new Command('link')
    .description('Link two knowledge nodes')
    .argument('<source>', 'Source node ID')
    .argument('<type>', 'Link type: supersedes|contradicts|related')
    .argument('<target>', 'Target node ID')
    .option('-c, --context <text>', 'Why this link exists')
    .action((source, type, target, options) => {
      if (!['supersedes', 'contradicts', 'related'].includes(type)) {
        console.error(`Invalid link type: ${type}. Must be: supersedes, contradicts, related`);
        process.exit(1);
      }

      const link = createLink(source, type, target, options.context);
      if (!link) {
        console.error('Cannot link a node to itself.');
        process.exit(1);
      }
      console.log(`Linked: ${source} ${type} ${target}`);
    });
}
