import { Command } from 'commander';
import { listNodes } from '../../core/nodes.js';
import { getConflicts, getLinks } from '../../core/links.js';
import { resolveNamespace } from '../../core/mappings.js';
import { getDatabase, getVaultRoot } from '../../db/connection.js';
import { namespaceFilter } from '../../core/namespace-filter.js';
import { detectFormat, type Format } from '../format.js';

interface ContextBrief {
  namespace: string | null;
  loaded_at: string;
  total_nodes: number;
  active_nodes: {
    id: string;
    title: string | null;
    summary: string;
    updated_at: string;
    links_out: number;
  }[];
  conflicts: {
    node_a: string;
    node_b: string;
    description: string | null;
  }[];
  stale_alerts: {
    id: string;
    title: string | null;
    stale_since: string | null;
    reason: string;
  }[];
}

function getStaleReason(node: any): string {
  const db = getDatabase();
  // Check if superseded
  const superseded = db.prepare(
    "SELECT COUNT(*) as c FROM links WHERE target_id = ? AND link_type = 'supersedes'"
  ).get(node.id) as { c: number };
  if (superseded.c > 0) return 'superseded';

  return `age`;
}

export function contextCommand(): Command {
  return new Command('context')
    .description('Load context brief for current project')
    .option('-n, --namespace <ns>', 'Namespace (auto-detected from cwd if omitted)')
    .option('-l, --limit <number>', 'Max active nodes', '5')
    .option('-f, --format <fmt>', 'Output format')
    .action((options) => {
      const namespace = options.namespace || resolveNamespace(process.cwd(), getVaultRoot()) || null;
      const limit = parseInt(options.limit);
      const db = getDatabase();

      // Total node count for this namespace
      const nsf = namespaceFilter(namespace);
      const countQuery = nsf
        ? db.prepare(`SELECT COUNT(*) as c FROM nodes WHERE status = 'active' AND ${nsf.sql}`).get(...nsf.params)
        : db.prepare("SELECT COUNT(*) as c FROM nodes WHERE status = 'active'").get();
      const totalNodes = (countQuery as { c: number }).c;

      const activeNodes = listNodes({
        namespace: namespace || undefined,
        status: 'active',
        limit,
      });

      const staleNodes = listNodes({
        namespace: namespace || undefined,
        status: 'stale',
        limit: 3,
      });

      const conflicts = getConflicts(namespace || undefined);

      const brief: ContextBrief = {
        namespace,
        loaded_at: new Date().toISOString(),
        total_nodes: totalNodes,
        active_nodes: activeNodes.map(n => ({
          id: n.id,
          title: n.title,
          summary: n.content.substring(0, 200) + (n.content.length > 200 ? '...' : ''),
          updated_at: n.updated_at,
          links_out: getLinks(n.id).length,
        })),
        conflicts: conflicts.map(c => ({
          node_a: c.nodeA,
          node_b: c.nodeB,
          description: c.context,
        })),
        stale_alerts: staleNodes.map(n => ({
          id: n.id,
          title: n.title,
          stale_since: n.stale_at,
          reason: getStaleReason(n),
        })),
      };

      const format: Format = options.format || detectFormat(Boolean(process.stdout.isTTY));

      if (format === 'json') {
        console.log(JSON.stringify(brief, null, 2));
      } else {
        console.log(`Context: ${namespace || '(all namespaces)'} (${totalNodes} active nodes)`);
        console.log('');
        if (brief.active_nodes.length > 0) {
          console.log('Active knowledge:');
          for (const n of brief.active_nodes) {
            const linkInfo = n.links_out > 0 ? ` [${n.links_out} links]` : '';
            console.log(`  [${n.id}] ${n.title || '(untitled)'}${linkInfo}`);
            console.log(`    ${n.summary}`);
          }
        }
        if (brief.conflicts.length > 0) {
          console.log('\nConflicts:');
          for (const c of brief.conflicts) {
            console.log(`  ${c.node_a} contradicts ${c.node_b}${c.description ? ': ' + c.description : ''}`);
          }
        }
        if (brief.stale_alerts.length > 0) {
          console.log('\nStale:');
          for (const n of brief.stale_alerts) {
            console.log(`  [${n.id}] ${n.title || '(untitled)'} — ${n.reason} (since ${n.stale_since})`);
          }
        }
        if (totalNodes === 0 && brief.stale_alerts.length === 0) {
          console.log('No knowledge captured yet. Use `kt capture` to start.');
        }
      }
    });
}
