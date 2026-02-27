import { Command } from 'commander';

export function serveCommand(): Command {
  return new Command('serve')
    .description('Start the kt MCP server')
    .option('-p, --port <port>', 'Port to listen on', '3847')
    .option('--host <host>', 'Host to bind to', '0.0.0.0')
    .option('--auth-path <path>', 'Path to auth.json')
    .action(async (options) => {
      const { startServer } = await import('../../mcp/server.js');
      await startServer({
        port: parseInt(options.port, 10),
        host: options.host,
        authPath: options.authPath,
      });
    });
}
