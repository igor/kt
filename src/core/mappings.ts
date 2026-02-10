import { getDatabase } from '../db/connection.js';

export interface ProjectMapping {
  directory_pattern: string;
  namespace: string;
}

export function addMapping(directoryPattern: string, namespace: string): void {
  const db = getDatabase();
  db.prepare(`
    INSERT OR REPLACE INTO project_mappings (directory_pattern, namespace)
    VALUES (?, ?)
  `).run(directoryPattern, namespace);
}

export function listMappings(): ProjectMapping[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM project_mappings ORDER BY directory_pattern').all() as ProjectMapping[];
}

export function resolveNamespace(directory: string): string | null {
  const db = getDatabase();
  const mappings = db.prepare(
    'SELECT * FROM project_mappings ORDER BY length(directory_pattern) DESC'
  ).all() as ProjectMapping[];

  for (const mapping of mappings) {
    const pattern = mapping.directory_pattern.replace(/\/?\*$/, '');
    if (directory.startsWith(pattern)) {
      return mapping.namespace;
    }
  }

  return null;
}

export function removeMapping(directoryPattern: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM project_mappings WHERE directory_pattern = ?').run(directoryPattern);
}
