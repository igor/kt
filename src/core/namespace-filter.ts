interface NamespaceFilterResult {
  sql: string;
  params: string[];
}

export function namespaceFilter(ns: string | undefined): NamespaceFilterResult | null {
  if (!ns) return null;
  return {
    sql: '(namespace = ? OR namespace LIKE ?)',
    params: [ns, `${ns}.%`],
  };
}
