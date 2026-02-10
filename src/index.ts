#!/usr/bin/env node

import { Command } from 'commander';
import { createDatabase, getDefaultDbPath } from './db/connection.js';
import { captureCommand } from './cli/commands/capture.js';
import { showCommand } from './cli/commands/show.js';
import { searchCommand } from './cli/commands/search.js';
import { linkCommand } from './cli/commands/link.js';
import { statusCommand } from './cli/commands/status.js';
import { deleteCommand } from './cli/commands/delete.js';
import { nsCommand } from './cli/commands/ns.js';
import { mapCommand } from './cli/commands/map.js';
import { staleCommand } from './cli/commands/stale.js';
import { statsCommand } from './cli/commands/stats.js';
import { contextCommand } from './cli/commands/context.js';
import { embedCommand } from './cli/commands/embed.js';

// Initialize database
const dbPath = process.env.KT_DB_PATH || getDefaultDbPath();
createDatabase(dbPath);

const program = new Command()
  .name('kt')
  .description('Knowledge Tracker — CLI-first knowledge management for AI agents')
  .version('0.1.0');

program.addCommand(captureCommand());
program.addCommand(showCommand());
program.addCommand(searchCommand());
program.addCommand(linkCommand());
program.addCommand(statusCommand());
program.addCommand(deleteCommand());
program.addCommand(nsCommand());
program.addCommand(mapCommand());
program.addCommand(staleCommand());
program.addCommand(statsCommand());
program.addCommand(contextCommand());
program.addCommand(embedCommand());

program.parse();
