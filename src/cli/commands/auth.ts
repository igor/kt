import { Command } from 'commander';
import { createToken, revokeToken, loadAuthConfig, getDefaultAuthPath } from '../../mcp/auth.js';

export function authCommand(): Command {
  const cmd = new Command('auth')
    .description('Manage MCP server authentication tokens');

  cmd.command('create-token')
    .argument('<user>', 'User identifier')
    .option('--auth-path <path>', 'Path to auth.json')
    .action((user, options) => {
      const authPath = options.authPath ?? getDefaultAuthPath();
      const token = createToken(user, authPath);
      console.log(`Token created for user "${user}":`);
      console.log(token);
    });

  cmd.command('list-tokens')
    .option('--auth-path <path>', 'Path to auth.json')
    .action((options) => {
      const authPath = options.authPath ?? getDefaultAuthPath();
      const config = loadAuthConfig(authPath);
      const entries = Object.entries(config.tokens);
      if (entries.length === 0) {
        console.log('No tokens configured.');
        return;
      }
      for (const [token, info] of entries) {
        const preview = token.substring(0, 12) + '...';
        console.log(`${preview}  user=${info.user}  created=${info.created}`);
      }
    });

  cmd.command('revoke-token')
    .argument('<token>', 'Token to revoke')
    .option('--auth-path <path>', 'Path to auth.json')
    .action((token, options) => {
      const authPath = options.authPath ?? getDefaultAuthPath();
      const result = revokeToken(token, authPath);
      if (result) {
        console.log('Token revoked.');
      } else {
        console.error('Token not found.');
        process.exit(1);
      }
    });

  return cmd;
}
