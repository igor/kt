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
      };

      const format: Format = options.format || detectFormat(Boolean(process.stdout.isTTY));

      if (format === 'json') {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log(`Total: ${total}  (active: ${active}, stale: ${stale}, compacted: ${compacted})`);
        console.log(`Pending embeddings: ${pending}`);
        if (byNs.length > 0) {
          console.log('\nBy namespace:');
          for (const ns of byNs) {
            console.log(`  ${ns.namespace}: ${ns.count}`);
          }
        }
      }
    });
}
