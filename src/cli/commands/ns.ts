import { Command } from 'commander';
import { createNamespace, listNamespaces, deleteNamespace } from '../../core/namespaces.js';
import { detectFormat, type Format } from '../format.js';

export function nsCommand(): Command {
  const ns = new Command('ns').description('Manage namespaces');

  ns.command('create')
    .argument('<slug>', 'Namespace slug')
    .option('--name <name>', 'Display name')
    .option('--description <desc>', 'Description')
    .action((slug, options) => {
      createNamespace(slug, options.name || slug, options.description);
      console.log(`Created namespace: ${slug}`);
    });

  ns.command('list')
    .option('-f, --format <fmt>', 'Output format')
    .action((options) => {
      const namespaces = listNamespaces();
      const format: Format = options.format || detectFormat(Boolean(process.stdout.isTTY));

      if (format === 'json') {
        console.log(JSON.stringify(namespaces, null, 2));
      } else {
        if (namespaces.length === 0) {
          console.log('No namespaces.');
        } else {
          for (const ns of namespaces) {
            console.log(`${ns.slug}  ${ns.name}${ns.description ? '  — ' + ns.description : ''}`);
          }
        }
      }
    });

  ns.command('delete')
    .argument('<slug>', 'Namespace slug')
    .action((slug) => {
      deleteNamespace(slug);
      console.log(`Deleted namespace: ${slug}`);
    });

  return ns;
}
