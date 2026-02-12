import { resolveNamespace } from '../../core/mappings.js';
import { generateDigest } from '../../core/digest.js';
import { getDatabase } from '../../db/connection.js';

interface DigestCliOptions {
  days?: string;
  fresh?: boolean;
  namespace?: string;
}

function resolveProjectDir(namespace: string): string | undefined {
  const db = getDatabase();
  const mapping = db.prepare(
    'SELECT directory_pattern FROM project_mappings WHERE namespace = ? ORDER BY length(directory_pattern) DESC LIMIT 1'
  ).get(namespace) as { directory_pattern: string } | undefined;

  if (mapping) {
    return mapping.directory_pattern.replace(/\/?\*$/, '');
  }
  return undefined;
}

export async function runDigest(options: DigestCliOptions): Promise<void> {
  const namespace = options.namespace || resolveNamespace(process.cwd());

  if (!namespace) {
    console.log('No namespace mapped for this directory.');
    console.log(`Use \`kt map <pattern> <namespace>\` to set one up.`);
    console.log(`Example: kt map "${process.cwd()}/*" my-project`);
    return;
  }

  const days = options.days ? parseInt(options.days) : 2;
  const projectDir = resolveProjectDir(namespace);

  const digest = await generateDigest(namespace, {
    days,
    fresh: options.fresh,
    projectDir,
  });

  console.log(digest);
}
