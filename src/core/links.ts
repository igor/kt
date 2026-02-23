import { getDatabase } from '../db/connection.js';
import { generateId } from './ids.js';
import { updateNodeStatus } from './nodes.js';

export interface Link {
  id: string;
  source_id: string;
  target_id: string;
  link_type: 'supersedes' | 'contradicts' | 'related';
  context: string | null;
  created_at: string;
}

export function createLink(
  sourceId: string,
  linkType: 'supersedes' | 'contradicts' | 'related',
  targetId: string,
  context?: string,
): Link | null {
  if (sourceId === targetId) return null;

  const db = getDatabase();
  const id = generateId(`${sourceId}-${linkType}-${targetId}`);

  db.prepare(`
    INSERT INTO links (id, source_id, target_id, link_type, context)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, sourceId, targetId, linkType, context || null);

  // Link-driven behavior: supersedes marks target stale
  if (linkType === 'supersedes') {
    updateNodeStatus(targetId, 'stale');
  }

  return db.prepare('SELECT * FROM links WHERE id = ?').get(id) as Link;
}

export function getLinks(nodeId: string): Link[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM links WHERE source_id = ? ORDER BY created_at DESC'
  ).all(nodeId) as Link[];
}

export function getBacklinks(nodeId: string): Link[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM links WHERE target_id = ? ORDER BY created_at DESC'
  ).all(nodeId) as Link[];
}

export function getConflicts(namespace?: string): { nodeA: string; nodeB: string; context: string | null }[] {
  const db = getDatabase();
  const query = namespace
    ? `SELECT l.source_id, l.target_id, l.context
       FROM links l
       JOIN nodes n1 ON l.source_id = n1.id
       JOIN nodes n2 ON l.target_id = n2.id
       WHERE l.link_type = 'contradicts'
       AND n1.status = 'active' AND n2.status = 'active'
       AND n1.namespace = ?`
    : `SELECT l.source_id, l.target_id, l.context
       FROM links l
       JOIN nodes n1 ON l.source_id = n1.id
       JOIN nodes n2 ON l.target_id = n2.id
       WHERE l.link_type = 'contradicts'
       AND n1.status = 'active' AND n2.status = 'active'`;

  const rows = namespace
    ? db.prepare(query).all(namespace)
    : db.prepare(query).all();

  return (rows as any[]).map(r => ({
    nodeA: r.source_id,
    nodeB: r.target_id,
    context: r.context,
  }));
}
