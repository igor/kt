import { Command } from 'commander';
import { deleteNode, getNode } from '../../core/nodes.js';

export function deleteCommand(): Command {
  return new Command('delete')
    .description('Delete a knowledge node')
    .argument('<id>', 'Node ID')
    .action((id) => {
      const node = getNode(id);
      if (!node) {
        console.error(`Node ${id} not found`);
        process.exit(1);
      }

      deleteNode(id);
      console.log(`Deleted ${id}`);
    });
}
