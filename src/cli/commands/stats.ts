import { Command } from 'commander';
import { getDatabase } from '../../db/connection.js';
import { detectFormat, type Format } from '../format.js';

interface Stats {
  total: number;
  active: number;
  stale: number;
  compacted: number;
  by_namespace: { namespace: string; count: number }[];
  embedded: number;
  pending_embeddings: number;
  embedding_coverage: string;
  compaction_summaries: number;
  oldest_active: string | null;
}

export function statsCommand(): Command {
  return new Command('stats')
    .description('Show knowledge base statistics')
    .option('-n, --namespace <ns>', 'Filter by namespace')
    .option('-f, --format <fmt>', 'Output format')
    .action((options) => {
      const db = getDatabase();
      const ns = options.namespace;
      const nsFilter = ns ? ' AND namespace = ?' : '';
      const nsParams = ns ? [ns] : [];

      const total = (db.prepare(`SELECT COUNT(*) as c FROM nodes WHERE 1=1${nsFilter}`).get(...nsParams) as any).c;
      const active = (db.prepare(`SELECT COUNT(*) as c FROM nodes WHERE status = 'active'${nsFilter}`).get(...nsParams) as any).c;
      const stale = (db.prepare(`SELECT COUNT(*) as c FROM nodes WHERE status = 'stale'${nsFilter}`).get(...nsParams) as any).c;
      const compacted = (db.prepare(`SELECT COUNT(*) as c FROM nodes WHERE status = 'compacted'${nsFilter}`).get(...nsParams) as any).c;
      const pending = (db.prepare(`SELECT COUNT(*) as c FROM nodes WHERE embedding_pending = 1${nsFilter}`).get(...nsParams) as any).c;
      const summaries = (db.prepare(`SELECT COUNT(*) as c FROM nodes WHERE source_type = 'compaction'${nsFilter}`).get(...nsParams) as any).c;

      const oldest = db.prepare(
        `SELECT updated_at FROM nodes WHERE status = 'active'${nsFilter} ORDER BY updated_at ASC LIMIT 1`
      ).get(...nsParams) as { updated_at: string } | undefined;

      const byNs = ns
        ? db.prepare(
            "SELECT namespace, COUNT(*) as count FROM nodes WHERE status != 'compacted' AND namespace = ? GROUP BY namespace ORDER BY count DESC"
          ).all(ns) as { namespace: string; count: number }[]
        : db.prepare(
            "SELECT namespace, COUNT(*) as count FROM nodes WHERE status != 'compacted' GROUP BY namespace ORDER BY count DESC"
          ).all() as { namespace: string; count: number }[];

      const embedded = total - pending;
      const coveragePct = total > 0 ? Math.round((embedded / total) * 100) : 100;

      const stats: Stats = {
        total,
        active,
        stale,
        compacted,
        by_namespace: byNs,
        embedded,
        pending_embeddings: pending,
        embedding_coverage: `${embedded}/${total} (${coveragePct}%)`,
        compaction_summaries: summaries,
        oldest_active: oldest?.updated_at || null,
      };

      const format: Format = options.format || detectFormat(Boolean(process.stdout.isTTY));

      if (format === 'json') {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log(`Total: ${total}  (active: ${active}, stale: ${stale}, compacted: ${compacted})`);
        console.log(`Compaction summaries: ${summaries}`);
        console.log(`Embedding coverage: ${embedded}/${total} (${coveragePct}%)`);
        if (pending > 0) {
          console.log(`  ⚠ ${pending} nodes missing embeddings — run kt embed`);
        }
        if (oldest) {
          console.log(`Oldest active node: ${oldest.updated_at}`);
        }
        if (byNs.length > 0) {
          console.log('\nBy namespace:');
          for (const ns of byNs) {
            console.log(`  ${ns.namespace}: ${ns.count}`);
          }
        }
      }
    });
}
