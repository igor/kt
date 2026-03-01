import path from 'path';
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

const MAX_NAMESPACE_DEPTH = 3;

export function resolveNamespaceFromVault(cwd: string, vaultRoot: string): string | null {
  const relative = path.relative(vaultRoot, cwd);
  if (!relative || relative === '.') return null;

  const segments = relative.split(path.sep).filter(Boolean);
  const capped = segments.slice(0, MAX_NAMESPACE_DEPTH);
  return capped.join('.');
}

export function resolveNamespace(directory: string, vaultRoot?: string | null): string | null {
  // Vault-local: derive from folder path
  if (vaultRoot) {
    return resolveNamespaceFromVault(directory, vaultRoot);
  }

  // Global fallback: use project_mappings (existing logic)
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
