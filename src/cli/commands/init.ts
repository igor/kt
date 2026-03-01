import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { createDatabase, closeDatabase } from '../../db/connection.js';

export function initCommand(): Command {
  return new Command('init')
    .description('Initialize a kt knowledge base in the current directory')
    .action(() => {
      const ktDir = path.join(process.cwd(), '.kt');

      if (fs.existsSync(ktDir)) {
        console.log('kt already initialized in this directory.');
        return;
      }

      fs.mkdirSync(ktDir, { recursive: true });
      const dbPath = path.join(ktDir, 'kt.db');
      createDatabase(dbPath);
      closeDatabase();

      console.log(`Initialized kt in ${ktDir}`);
      console.log('Knowledge base ready. Use `kt capture` to start.');
    });
}
