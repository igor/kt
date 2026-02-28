import { getDatabase } from '../db/connection.js';

export interface Namespace {
  slug: string;
  name: string;
  description: string | null;
}

export function createNamespace(slug: string, name: string, description?: string): Namespace {
  const db = getDatabase();
  db.prepare(`
    INSERT OR IGNORE INTO namespaces (slug, name, description) VALUES (?, ?, ?)
  `).run(slug, name, description || null);
  return getNamespace(slug)!;
}

export function ensureNamespace(slug: string): void {
  const db = getDatabase();
  const parts = slug.split('.');
  for (let i = 1; i <= parts.length; i++) {
    const prefix = parts.slice(0, i).join('.');
    db.prepare(`
      INSERT OR IGNORE INTO namespaces (slug, name) VALUES (?, ?)
    `).run(prefix, prefix);
  }
}

export function getNamespace(slug: string): Namespace | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM namespaces WHERE slug = ?').get(slug);
  return (row as Namespace) || null;
}

export function listNamespaces(): Namespace[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM namespaces ORDER BY slug').all() as Namespace[];
}

export function deleteNamespace(slug: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM namespaces WHERE slug = ?').run(slug);
}
