import { getDatabase } from '../db/connection.js';
import { updateNodeStatus } from './nodes.js';
import { namespaceFilter } from './namespace-filter.js';

interface DetectStaleOptions {
  maxAgeDays?: number;
  orphanAgeDays?: number;
  namespace?: string;
  protectReferenced?: boolean;
}

interface DetectStaleResult {
  staled: string[];
  skipped: number;
}

export function detectStaleNodes(options: DetectStaleOptions = {}): DetectStaleResult {
  const db = getDatabase();
  const maxAgeDays = options.maxAgeDays ?? 60;
  const orphanAgeDays = options.orphanAgeDays ?? maxAgeDays;
  const protectReferenced = options.protectReferenced ?? false;

  const staled: string[] = [];
  let skipped = 0;

  // Find active nodes older than threshold
  const conditions: string[] = [
    "status = 'active'",
    `updated_at < datetime('now', '-${maxAgeDays} days')`,
  ];
  const params: any[] = [];

  const nsFilter = namespaceFilter(options.namespace);
  if (nsFilter) {
    conditions.push(nsFilter.sql);
    params.push(...nsFilter.params);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const candidates = db.prepare(`SELECT id FROM nodes ${where}`).all(...params) as { id: string }[];

  for (const candidate of candidates) {
    // Check if protected by recent references
    if (protectReferenced) {
      const recentLinks = db.prepare(`
        SELECT COUNT(*) as c FROM links
        WHERE target_id = ? AND created_at > datetime('now', '-${maxAgeDays} days')
      `).get(candidate.id) as { c: number };

      if (recentLinks.c > 0) {
        skipped++;
        continue;
      }
    }

    updateNodeStatus(candidate.id, 'stale');
    staled.push(candidate.id);
  }

  // Also check orphan nodes (no inbound links, older than orphanAgeDays)
  if (orphanAgeDays < maxAgeDays) {
    const orphanConditions: string[] = [
      "n.status = 'active'",
      `n.updated_at < datetime('now', '-${orphanAgeDays} days')`,
      `n.updated_at >= datetime('now', '-${maxAgeDays} days')`,
    ];

    const orphanNsFilter = namespaceFilter(options.namespace);
    if (orphanNsFilter) {
      orphanConditions.push(orphanNsFilter.sql.replace(/namespace/g, 'n.namespace'));
    }

    const orphanWhere = `WHERE ${orphanConditions.join(' AND ')}`;
    const orphanQuery = `
      SELECT n.id FROM nodes n
      LEFT JOIN links l ON l.target_id = n.id
      ${orphanWhere}
      GROUP BY n.id
      HAVING COUNT(l.id) = 0
    `;

    const orphanParams = orphanNsFilter ? orphanNsFilter.params : [];
    const orphans = db.prepare(orphanQuery).all(...orphanParams) as { id: string }[];

    for (const orphan of orphans) {
      if (!staled.includes(orphan.id)) {
        updateNodeStatus(orphan.id, 'stale');
        staled.push(orphan.id);
      }
    }
  }

  return { staled, skipped };
}
