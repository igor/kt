import { Command } from 'commander';
import { updateNodeStatus, getNode } from '../../core/nodes.js';

export function statusCommand(): Command {
  return new Command('status')
    .description('Update node status')
    .argument('<id>', 'Node ID')
    .argument('<status>', 'New status: active|stale')
    .action((id, status) => {
      if (!['active', 'stale'].includes(status)) {
        console.error('Status must be: active, stale');
        process.exit(1);
      }

      const node = getNode(id);
      if (!node) {
        console.error(`Node ${id} not found`);
        process.exit(1);
      }

      updateNodeStatus(id, status as 'active' | 'stale');
      console.log(`${id} → ${status}`);
    });
}
