import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { validateToken, getDefaultAuthPath } from './auth.js';
import { handleSearch, handleCapture, handleContext, handleShow, handleListNamespaces } from './tools.js';

export interface ServeOptions {
  port: number;
  host: string;
  authPath?: string;
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'kt-knowledge-tracker',
    version: '0.2.0',
  });

  server.registerTool(
    'kt_search',
    {
      title: 'Search Knowledge',
      description: 'Search knowledge nodes by keyword. Returns matching nodes with title, content preview, and metadata.',
      inputSchema: z.object({
        query: z.string().describe('Search query'),
        namespace: z.string().optional().describe('Filter by namespace (e.g., "explicit-protocol")'),
        limit: z.number().optional().describe('Max results (default 10)'),
      }),
    },
    async (params) => handleSearch(params),
  );

  server.registerTool(
    'kt_capture',
    {
      title: 'Capture Knowledge',
      description: 'Capture a new knowledge node. Each node should be self-contained and readable without session context.',
      inputSchema: z.object({
        content: z.string().describe('Knowledge content to capture'),
        title: z.string().optional().describe('Short title for the node'),
        namespace: z.string().optional().describe('Target namespace (default: "default")'),
        tags: z.array(z.string()).optional().describe('Tags for categorization'),
      }),
    },
    async (params) => handleCapture(params),
  );

  server.registerTool(
    'kt_context',
    {
      title: 'Get Knowledge Context',
      description: 'Load a context brief for a namespace: active nodes, conflicts, and stale alerts.',
      inputSchema: z.object({
        namespace: z.string().optional().describe('Namespace to load context for (default: "default")'),
        limit: z.number().optional().describe('Max active nodes to include (default 5)'),
      }),
    },
    async (params) => handleContext(params),
  );

  server.registerTool(
    'kt_show',
    {
      title: 'Show Knowledge Node',
      description: 'Get full details of a specific knowledge node by ID, including its links.',
      inputSchema: z.object({
        id: z.string().describe('Node ID (e.g., "kt-abc123")'),
      }),
    },
    async (params) => handleShow(params),
  );

  server.registerTool(
    'kt_list_namespaces',
    {
      title: 'List Namespaces',
      description: 'List all available knowledge namespaces.',
      inputSchema: z.object({}),
    },
    async () => handleListNamespaces(),
  );

  return server;
}

export async function startServer(options: ServeOptions): Promise<void> {
  const mcpServer = createMcpServer();
  const authPath = options.authPath ?? getDefaultAuthPath();
  const app = express();
  app.use(express.json());

  // Auth middleware
  app.use('/mcp', (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }
    const token = authHeader.slice(7);
    const tokenInfo = validateToken(token, authPath);
    if (!tokenInfo) {
      res.status(403).json({ error: 'Invalid token' });
      return;
    }
    next();
  });

  // MCP endpoint
  app.post('/mcp', async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on('close', () => { transport.close(); });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Health check (no auth required)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'kt-mcp' });
  });

  app.listen(options.port, options.host, () => {
    console.log(`kt MCP server listening on http://${options.host}:${options.port}/mcp`);
    console.log(`Auth config: ${authPath}`);
  });
}
