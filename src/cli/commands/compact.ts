import { Command } from 'commander';
import { detectStaleNodes } from '../../core/staleness.js';
import { dryRunCompaction, compactCluster } from '../../core/compact.js';
import { getNode } from '../../core/nodes.js';
import { detectFormat, type Format } from '../format.js';

export function compactCommand(): Command {
  return new Command('compact')
    .description('Compact stale knowledge into summaries')
    .option('-n, --namespace <ns>', 'Filter by namespace')
    .option('--dry-run', 'Preview compaction without executing')
    .option('--detect-stale', 'Run staleness detection before compaction')
    .option('--max-age <days>', 'Max age in days for staleness detection', '60')
    .option('--min-cluster <size>', 'Minimum cluster size', '3')
    .option('-f, --format <fmt>', 'Output format')
    .action(async (options) => {
      const format: Format = options.format || detectFormat(Boolean(process.stdout.isTTY));

      // Optionally run staleness detection first
      if (options.detectStale) {
        const staleResult = detectStaleNodes({
          maxAgeDays: parseInt(options.maxAge),
          namespace: options.namespace,
          protectReferenced: true,
        });

        if (format === 'json') {
          console.error(JSON.stringify({ staleness: staleResult }));
        } else {
          if (staleResult.staled.length > 0) {
            console.log(`Staleness detection: marked ${staleResult.staled.length} node(s) as stale (skipped ${staleResult.skipped}).`);
          } else {
            console.log('Staleness detection: no new stale nodes.');
          }
        }
      }

      // Detect clusters
      const plan = dryRunCompaction({
        namespace: options.namespace,
        minClusterSize: parseInt(options.minCluster),
      });

      if (plan.clusters.length === 0) {
        if (format === 'json') {
          console.log(JSON.stringify({ clusters: [], compacted: [] }));
        } else {
          console.log('No clusters found for compaction.');
        }
        return;
      }

      // Dry run — just show what would happen
      if (options.dryRun) {
        if (format === 'json') {
          const output = plan.clusters.map(c => ({
            namespace: c.namespace,
            node_count: c.nodeIds.length,
            node_ids: c.nodeIds,
            nodes: c.nodeIds.map(id => {
              const n = getNode(id);
              return n ? { id: n.id, title: n.title, content: n.content.substring(0, 100) } : null;
            }).filter(Boolean),
          }));
          console.log(JSON.stringify({ clusters: output, total_nodes: plan.totalNodes }, null, 2));
        } else {
          console.log(`Found ${plan.clusters.length} cluster(s) with ${plan.totalNodes} total nodes:\n`);
          for (let i = 0; i < plan.clusters.length; i++) {
            const c = plan.clusters[i];
            console.log(`Cluster ${i + 1}: ${c.nodeIds.length} nodes (${c.namespace})`);
            for (const id of c.nodeIds) {
              const n = getNode(id);
              if (n) {
                console.log(`  [${n.id}] ${n.title || '(untitled)'}`);
                console.log(`    ${n.content.substring(0, 80)}${n.content.length > 80 ? '...' : ''}`);
              }
            }
            console.log('');
          }
        }
        return;
      }

      // Execute compaction
      if (!process.env.ANTHROPIC_API_KEY) {
        console.error('Error: ANTHROPIC_API_KEY environment variable is required for compaction.');
        console.error('Set it with: export ANTHROPIC_API_KEY=your-key-here');
        process.exit(1);
      }

      console.log(`Compacting ${plan.clusters.length} cluster(s) with ${plan.totalNodes} nodes...`);
      const results = [];

      for (let i = 0; i < plan.clusters.length; i++) {
        const cluster = plan.clusters[i];
        console.log(`\nCluster ${i + 1}/${plan.clusters.length} (${cluster.nodeIds.length} nodes)...`);

        const result = await compactCluster(cluster);
        if (result) {
          results.push(result);
          console.log(`  → Created summary: ${result.summaryNode.id} "${result.summaryNode.title}"`);
          console.log(`  → Compacted ${result.compactedIds.length} nodes`);
        } else {
          console.log('  → Failed (summarization error)');
        }
      }

      if (format === 'json') {
        console.log(JSON.stringify({
          compacted: results.map(r => ({
            summary_id: r.summaryNode.id,
            summary_title: r.summaryNode.title,
            compacted_count: r.compactedIds.length,
            compacted_ids: r.compactedIds,
          })),
        }, null, 2));
      } else {
        console.log(`\nDone: ${results.length} cluster(s) compacted.`);
      }
    });
}
