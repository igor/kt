import { Command } from 'commander';
import { addMapping, listMappings, removeMapping } from '../../core/mappings.js';
import { ensureNamespace } from '../../core/namespaces.js';
import { detectFormat, type Format } from '../format.js';

export function mapCommand(): Command {
  const map = new Command('map').description('Map directories to namespaces');

  map.command('add')
    .argument('<directory>', 'Directory pattern')
    .argument('<namespace>', 'Namespace slug')
    .action((directory, namespace) => {
      ensureNamespace(namespace);
      addMapping(directory, namespace);
      console.log(`Mapped: ${directory} → ${namespace}`);
    });

  map.command('list')
    .option('-f, --format <fmt>', 'Output format')
    .action((options) => {
      const mappings = listMappings();
      const format: Format = options.format || detectFormat(Boolean(process.stdout.isTTY));

      if (format === 'json') {
        console.log(JSON.stringify(mappings, null, 2));
      } else {
        if (mappings.length === 0) {
          console.log('No mappings.');
        } else {
          for (const m of mappings) {
            console.log(`${m.directory_pattern} → ${m.namespace}`);
          }
        }
      }
    });

  map.command('remove')
    .argument('<directory>', 'Directory pattern')
    .action((directory) => {
      removeMapping(directory);
      console.log(`Removed mapping: ${directory}`);
    });

  return map;
}
