import { Command } from 'commander';
import { getDatabase } from '../../db/connection.js';
import { detectFormat, type Format } from '../format.js';

interface Stats {
  total: number;
  active: number;
  stale: number;
  compacted: number;
  by_namespace: { namespace: string; count: number }[];
  pending_embeddings: number;
  compaction_summaries: number;
  oldest_active: string | null;
}

export function statsCommand(): Command {
  return new Command('stats')
    .description('Show knowledge base statistics')
    .option('-f, --format <fmt>', 'Output format')
    .action((options) => {
      const db = getDatabase();

      const total = (db.prepare('SELECT COUNT(*) as c FROM nodes').get() as any).c;
      const active = (db.prepare("SELECT COUNT(*) as c FROM nodes WHERE status = 'active'").get() as any).c;
      const stale = (db.prepare("SELECT COUNT(*) as c FROM nodes WHERE status = 'stale'").get() as any).c;
      const compacted = (db.prepare("SELECT COUNT(*) as c FROM nodes WHERE status = 'compacted'").get() as any).c;
      const pending = (db.prepare('SELECT COUNT(*) as c FROM nodes WHERE embedding_pending = 1').get() as any).c;
      const summaries = (db.prepare("SELECT COUNT(*) as c FROM nodes WHERE source_type = 'compaction'").get() as any).c;

      const oldest = db.prepare(
        "SELECT updated_at FROM nodes WHERE status = 'active' ORDER BY updated_at ASC LIMIT 1"
      ).get() as { updated_at: string } | undefined;

      const byNs = db.prepare(
        "SELECT namespace, COUNT(*) as count FROM nodes WHERE status != 'compacted' GROUP BY namespace ORDER BY count DESC"
      ).all() as { namespace: string; count: number }[];

      const stats: Stats = {
        total,
        active,
        stale,
        compacted,
        by_namespace: byNs,
        pending_embeddings: pending,
        compaction_summaries: summaries,
        oldest_active: oldest?.updated_at || null,
      };

      const format: Format = options.format || detectFormat(Boolean(process.stdout.isTTY));

      if (format === 'json') {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log(`Total: ${total}  (active: ${active}, stale: ${stale}, compacted: ${compacted})`);
        console.log(`Compaction summaries: ${summaries}`);
        console.log(`Pending embeddings: ${pending}`);
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
