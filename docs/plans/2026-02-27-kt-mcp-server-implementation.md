# kt MCP Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an MCP server that exposes kt's core operations (search, capture, context, show, list namespaces) over streamable HTTP, with bearer token auth, deployable on Mac Mini.

**Architecture:** Thin MCP layer over existing kt core modules. Express + `@modelcontextprotocol/sdk` with streamable HTTP transport. Auth middleware validates bearer tokens from `~/.kt/auth.json`. New CLI command `kt serve` starts the server.

**Tech Stack:** Express, `@modelcontextprotocol/sdk`, Zod (for MCP tool schemas), existing kt core (better-sqlite3, commander)

**Design doc:** `docs/plans/2026-02-27-kt-mcp-server-design.md`

## Task 1: Add MCP Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install dependencies**

Run:
```bash
cd /Users/zeigor/GitHub/kt
npm install @modelcontextprotocol/sdk express zod
npm install --save-dev @types/express
```

**Step 2: Verify installation**

Run: `npm ls @modelcontextprotocol/sdk express zod`
Expected: All three packages listed without errors

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add MCP server dependencies (express, mcp-sdk, zod)"
```

## Task 2: Create Auth Module with Tests

**Files:**
- Create: `src/mcp/auth.ts`
- Create: `tests/mcp/auth.test.ts`

**Step 1: Write the failing tests**

Create `tests/mcp/auth.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadAuthConfig, validateToken, createToken, revokeToken } from '../../src/mcp/auth.js';

const testDir = path.join(os.tmpdir(), 'kt-test-auth-' + Date.now());
const authPath = path.join(testDir, 'auth.json');

beforeEach(() => {
  fs.mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('auth', () => {
  describe('loadAuthConfig', () => {
    it('returns empty tokens when file does not exist', () => {
      const config = loadAuthConfig(path.join(testDir, 'nonexistent.json'));
      expect(config.tokens).toEqual({});
    });

    it('loads existing config', () => {
      fs.writeFileSync(authPath, JSON.stringify({
        tokens: { 'tok_abc': { user: 'alice', created: '2026-01-01' } }
      }));
      const config = loadAuthConfig(authPath);
      expect(config.tokens['tok_abc'].user).toBe('alice');
    });
  });

  describe('validateToken', () => {
    it('returns user info for valid token', () => {
      fs.writeFileSync(authPath, JSON.stringify({
        tokens: { 'tok_abc': { user: 'alice', created: '2026-01-01' } }
      }));
      const result = validateToken('tok_abc', authPath);
      expect(result).toEqual({ user: 'alice', created: '2026-01-01' });
    });

    it('returns null for invalid token', () => {
      fs.writeFileSync(authPath, JSON.stringify({ tokens: {} }));
      const result = validateToken('tok_invalid', authPath);
      expect(result).toBeNull();
    });

    it('returns null when auth file missing', () => {
      const result = validateToken('tok_abc', path.join(testDir, 'missing.json'));
      expect(result).toBeNull();
    });
  });

  describe('createToken', () => {
    it('creates a new token and writes to file', () => {
      const token = createToken('bob', authPath);
      expect(token).toMatch(/^tok_/);
      const config = loadAuthConfig(authPath);
      expect(config.tokens[token].user).toBe('bob');
    });

    it('preserves existing tokens when adding new one', () => {
      fs.writeFileSync(authPath, JSON.stringify({
        tokens: { 'tok_existing': { user: 'alice', created: '2026-01-01' } }
      }));
      createToken('bob', authPath);
      const config = loadAuthConfig(authPath);
      expect(config.tokens['tok_existing']).toBeDefined();
      expect(Object.keys(config.tokens)).toHaveLength(2);
    });
  });

  describe('revokeToken', () => {
    it('removes a token', () => {
      fs.writeFileSync(authPath, JSON.stringify({
        tokens: { 'tok_abc': { user: 'alice', created: '2026-01-01' } }
      }));
      const result = revokeToken('tok_abc', authPath);
      expect(result).toBe(true);
      const config = loadAuthConfig(authPath);
      expect(config.tokens['tok_abc']).toBeUndefined();
    });

    it('returns false for nonexistent token', () => {
      fs.writeFileSync(authPath, JSON.stringify({ tokens: {} }));
      const result = revokeToken('tok_nope', authPath);
      expect(result).toBe(false);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/auth.test.ts`
Expected: FAIL — module not found

**Step 3: Implement auth module**

Create `src/mcp/auth.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface TokenInfo {
  user: string;
  created: string;
}

export interface AuthConfig {
  tokens: Record<string, TokenInfo>;
}

export function getDefaultAuthPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '~';
  return path.join(home, '.kt', 'auth.json');
}

export function loadAuthConfig(authPath: string): AuthConfig {
  try {
    const data = fs.readFileSync(authPath, 'utf-8');
    return JSON.parse(data) as AuthConfig;
  } catch {
    return { tokens: {} };
  }
}

function saveAuthConfig(config: AuthConfig, authPath: string): void {
  const dir = path.dirname(authPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(authPath, JSON.stringify(config, null, 2));
}

export function validateToken(token: string, authPath: string): TokenInfo | null {
  const config = loadAuthConfig(authPath);
  return config.tokens[token] ?? null;
}

export function createToken(user: string, authPath: string): string {
  const config = loadAuthConfig(authPath);
  const token = 'tok_' + crypto.randomBytes(24).toString('hex');
  config.tokens[token] = {
    user,
    created: new Date().toISOString().split('T')[0],
  };
  saveAuthConfig(config, authPath);
  return token;
}

export function revokeToken(token: string, authPath: string): boolean {
  const config = loadAuthConfig(authPath);
  if (!config.tokens[token]) return false;
  delete config.tokens[token];
  saveAuthConfig(config, authPath);
  return true;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/mcp/auth.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/mcp/auth.ts tests/mcp/auth.test.ts
git commit -m "feat: add auth module for MCP server token management"
```

## Task 3: Create MCP Tool Handlers with Tests

**Files:**
- Create: `src/mcp/tools.ts`
- Create: `tests/mcp/tools.test.ts`

These are thin wrappers that call existing core functions and format results for MCP.

**Step 1: Write the failing tests**

Create `tests/mcp/tools.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDatabase, closeDatabase } from '../../src/db/connection.js';
import { ensureNamespace } from '../../src/core/namespaces.js';
import { createNode } from '../../src/core/nodes.js';
import { handleSearch, handleCapture, handleContext, handleShow, handleListNamespaces } from '../../src/mcp/tools.js';

const testDir = path.join(os.tmpdir(), 'kt-test-mcp-tools-' + Date.now());
const testDb = path.join(testDir, 'kt.db');

beforeEach(() => {
  fs.mkdirSync(testDir, { recursive: true });
  createDatabase(testDb);
  ensureNamespace('test-ns');
});

afterEach(() => {
  closeDatabase();
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('MCP tool handlers', () => {
  describe('handleSearch', () => {
    it('returns matching nodes', () => {
      createNode({ namespace: 'test-ns', content: 'Tailscale networking guide', title: 'Tailscale' });
      const result = handleSearch({ query: 'Tailscale' });
      expect(result.content[0].type).toBe('text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].title).toBe('Tailscale');
    });

    it('filters by namespace', () => {
      ensureNamespace('other-ns');
      createNode({ namespace: 'test-ns', content: 'alpha content', title: 'Alpha' });
      createNode({ namespace: 'other-ns', content: 'alpha other', title: 'Alpha Other' });
      const result = handleSearch({ query: 'alpha', namespace: 'test-ns' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].namespace).toBe('test-ns');
    });

    it('returns empty array for no matches', () => {
      const result = handleSearch({ query: 'nonexistent' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results).toHaveLength(0);
    });
  });

  describe('handleCapture', () => {
    it('creates a node and returns it', () => {
      const result = handleCapture({
        content: 'Test knowledge capture',
        title: 'Test Capture',
        namespace: 'test-ns',
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.node.id).toMatch(/^kt-/);
      expect(parsed.node.title).toBe('Test Capture');
      expect(parsed.node.namespace).toBe('test-ns');
    });

    it('uses default namespace when not specified', () => {
      ensureNamespace('default');
      const result = handleCapture({
        content: 'No namespace specified',
        title: 'Default NS',
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.node.namespace).toBe('default');
    });
  });

  describe('handleContext', () => {
    it('returns context brief for namespace', () => {
      createNode({ namespace: 'test-ns', content: 'Context content', title: 'Context Node' });
      const result = handleContext({ namespace: 'test-ns' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.namespace).toBe('test-ns');
      expect(parsed.total_nodes).toBeGreaterThanOrEqual(1);
      expect(parsed.active_nodes).toBeInstanceOf(Array);
    });
  });

  describe('handleShow', () => {
    it('returns node details', () => {
      const node = createNode({ namespace: 'test-ns', content: 'Show me', title: 'Showable' });
      const result = handleShow({ id: node.id });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.node.id).toBe(node.id);
      expect(parsed.node.content).toBe('Show me');
    });

    it('returns error for missing node', () => {
      const result = handleShow({ id: 'kt-nonexistent' });
      expect(result.isError).toBe(true);
    });
  });

  describe('handleListNamespaces', () => {
    it('returns all namespaces', () => {
      ensureNamespace('ns-a');
      ensureNamespace('ns-b');
      const result = handleListNamespaces();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.namespaces.length).toBeGreaterThanOrEqual(2);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/tools.test.ts`
Expected: FAIL — module not found

**Step 3: Implement tool handlers**

Create `src/mcp/tools.ts`:

```typescript
import { searchNodes } from '../core/search.js';
import { captureWithIntelligence } from '../core/capture.js';
import { getNode } from '../core/nodes.js';
import { listNamespaces } from '../core/namespaces.js';
import { getLinks } from '../core/links.js';
import { detectStaleNodes } from '../core/staleness.js';

// Types matching MCP tool result format
interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}

// --- Tool Handlers ---

export function handleSearch(params: { query: string; namespace?: string; limit?: number }): ToolResult {
  const nodes = searchNodes(params.query, {
    namespace: params.namespace,
    limit: params.limit ?? 10,
  });
  return jsonResult({
    results: nodes.map(n => ({
      id: n.id,
      title: n.title,
      namespace: n.namespace,
      content: n.content.substring(0, 300),
      status: n.status,
      updated_at: n.updated_at,
    })),
  });
}

export function handleCapture(params: { content: string; title?: string; namespace?: string; tags?: string[] }): ToolResult {
  const namespace = params.namespace || 'default';
  const result = captureWithIntelligence({
    namespace,
    content: params.content,
    title: params.title,
    tags: params.tags,
    embedding: null,  // No Ollama access from remote — embeddings generated later
    autoLink: true,
  });
  return jsonResult({
    node: {
      id: result.node.id,
      title: result.node.title,
      namespace: result.node.namespace,
      content: result.node.content,
      created_at: result.node.created_at,
    },
    similar: result.similar.map(n => ({ id: n.id, title: n.title })),
    auto_linked: result.autoLinked,
  });
}

export function handleContext(params: { namespace?: string; limit?: number }): ToolResult {
  const namespace = params.namespace || 'default';
  const { getDatabase } = require('../db/connection.js');
  const db = getDatabase();

  const limit = params.limit ?? 5;

  // Replicate context command logic
  const nodes = db.prepare(
    `SELECT * FROM nodes WHERE namespace = ? AND status = 'active' ORDER BY updated_at DESC LIMIT ?`
  ).all(namespace, limit);

  const conflicts = db.prepare(
    `SELECT l.source_id as node_a, l.target_id as node_b, l.context as description
     FROM links l
     JOIN nodes n1 ON l.source_id = n1.id
     JOIN nodes n2 ON l.target_id = n2.id
     WHERE l.link_type = 'contradicts'
     AND n1.namespace = ? AND n1.status = 'active'
     AND n2.status = 'active'`
  ).all(namespace);

  const staleNodes = detectStaleNodes(namespace);

  return jsonResult({
    namespace,
    loaded_at: new Date().toISOString(),
    total_nodes: nodes.length,
    active_nodes: nodes.map((row: any) => ({
      id: row.id,
      title: row.title,
      summary: row.content.substring(0, 200),
      updated_at: row.updated_at,
      links_out: db.prepare('SELECT COUNT(*) as cnt FROM links WHERE source_id = ?').get(row.id)?.cnt ?? 0,
    })),
    conflicts,
    stale_alerts: staleNodes.map(n => ({
      id: n.id,
      title: n.title,
      stale_since: n.stale_at,
      reason: n.stale_at ? 'age' : 'superseded',
    })),
  });
}

export function handleShow(params: { id: string }): ToolResult {
  const node = getNode(params.id);
  if (!node) return errorResult(`Node ${params.id} not found`);

  const links = getLinks(params.id);
  return jsonResult({ node, links });
}

export function handleListNamespaces(): ToolResult {
  const namespaces = listNamespaces();
  return jsonResult({ namespaces });
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/mcp/tools.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "feat: add MCP tool handlers wrapping kt core functions"
```

## Task 4: Create MCP Server with Express + Streamable HTTP

**Files:**
- Create: `src/mcp/server.ts`

**Step 1: Implement the MCP server**

Create `src/mcp/server.ts`:

```typescript
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
```

**Step 2: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat: add MCP server with express + streamable HTTP transport"
```

## Task 5: Add `kt serve` and `kt auth` CLI Commands

**Files:**
- Create: `src/cli/commands/serve.ts`
- Create: `src/cli/commands/auth.ts`
- Modify: `src/index.ts` (register new commands)

**Step 1: Create the serve command**

Create `src/cli/commands/serve.ts`:

```typescript
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
```

**Step 2: Create the auth command**

Create `src/cli/commands/auth.ts`:

```typescript
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
```

**Step 3: Register commands in index.ts**

Add to `src/index.ts` after existing `addCommand` calls:

```typescript
import { serveCommand } from './cli/commands/serve.js';
import { authCommand } from './cli/commands/auth.js';

// ... after existing addCommand lines:
program.addCommand(serveCommand());
program.addCommand(authCommand());
```

**Step 4: Build and verify**

Run: `npm run build && kt serve --help`
Expected: Shows serve command help with port, host, auth-path options

Run: `kt auth --help`
Expected: Shows auth subcommands (create-token, list-tokens, revoke-token)

**Step 5: Commit**

```bash
git add src/cli/commands/serve.ts src/cli/commands/auth.ts src/index.ts
git commit -m "feat: add kt serve and kt auth CLI commands"
```

## Task 6: Integration Test — End to End

**Files:**
- Create: `tests/mcp/integration.test.ts`

**Step 1: Write integration test**

Create `tests/mcp/integration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

const testDir = path.join(os.tmpdir(), 'kt-test-mcp-integration-' + Date.now());

beforeEach(() => {
  fs.mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('kt auth CLI', () => {
  const authPath = () => path.join(testDir, 'auth.json');
  const kt = (args: string) =>
    execSync(`npx tsx src/index.ts ${args}`, {
      env: { ...process.env, KT_DB_PATH: path.join(testDir, 'kt.db') },
      encoding: 'utf-8',
    }).trim();

  it('create-token and list-tokens round trip', () => {
    const output = kt(`auth create-token testuser --auth-path ${authPath()}`);
    expect(output).toContain('tok_');

    const list = kt(`auth list-tokens --auth-path ${authPath()}`);
    expect(list).toContain('testuser');
  });

  it('revoke-token removes the token', () => {
    const output = kt(`auth create-token revokeuser --auth-path ${authPath()}`);
    const token = output.split('\n').pop()!.trim();

    kt(`auth revoke-token ${token} --auth-path ${authPath()}`);
    const list = kt(`auth list-tokens --auth-path ${authPath()}`);
    expect(list).not.toContain('revokeuser');
  });
});
```

**Step 2: Run integration test**

Run: `npx vitest run tests/mcp/integration.test.ts`
Expected: All tests PASS

**Step 3: Run full test suite**

Run: `npm test`
Expected: All existing tests still pass + new tests pass

**Step 4: Commit**

```bash
git add tests/mcp/integration.test.ts
git commit -m "test: add MCP auth CLI integration tests"
```

## Task 7: Mac Mini Deployment — launchd Service

**Files:**
- Create: `deploy/com.kt.mcp-server.plist`
- Create: `deploy/setup.sh`

**Step 1: Create launchd plist**

Create `deploy/com.kt.mcp-server.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.kt.mcp-server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>/opt/homebrew/lib/node_modules/kt/dist/index.js</string>
        <string>serve</string>
        <string>--port</string>
        <string>3847</string>
        <string>--host</string>
        <string>0.0.0.0</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/kt-mcp-server.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/kt-mcp-server.err</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>/Users/zeigor</string>
    </dict>
</dict>
</plist>
```

**Step 2: Create setup script**

Create `deploy/setup.sh`:

```bash
#!/bin/bash
set -euo pipefail

echo "=== kt MCP Server Deployment ==="

# Build
echo "Building kt..."
npm run build

# Create auth token if none exists
AUTH_PATH="$HOME/.kt/auth.json"
if [ ! -f "$AUTH_PATH" ]; then
    echo "No auth config found. Creating initial tokens..."
    kt auth create-token developer
    kt auth create-token partner
    echo ""
    echo "IMPORTANT: Save the partner token above — you'll need it for their MCP config."
fi

# Install launchd service
PLIST_SRC="$(cd "$(dirname "$0")" && pwd)/com.kt.mcp-server.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.kt.mcp-server.plist"

# Stop existing service if running
launchctl bootout gui/$(id -u) "$PLIST_DST" 2>/dev/null || true

cp "$PLIST_SRC" "$PLIST_DST"
launchctl bootstrap gui/$(id -u) "$PLIST_DST"

echo ""
echo "kt MCP server deployed and running on port 3847"
echo "Logs: /tmp/kt-mcp-server.log"
echo "Health: curl http://localhost:3847/health"
```

**Step 3: Commit**

```bash
chmod +x deploy/setup.sh
git add deploy/
git commit -m "feat: add Mac Mini deployment config (launchd service)"
```

## Task 8: Partner Onboarding Documentation

**Files:**
- Create: `docs/partner-onboarding.md`

**Step 1: Write onboarding guide**

Create `docs/partner-onboarding.md`:

```markdown
# kt Knowledge Tracker — Partner Setup

## What is kt?

kt is our shared knowledge tracker. It stores insights, decisions, and context from our Claude sessions so we can build on previous work instead of starting from scratch.

## Setup (One-Time)

### 1. Install Tailscale

1. Download from https://tailscale.com/download/mac
2. Install and sign in (you'll receive an invite to join our tailnet)
3. Verify connection: the Mac Mini should appear in your Tailscale network

### 2. Configure Claude Desktop

Open Claude Desktop settings, find the MCP configuration file, and add:

```json
{
  "mcpServers": {
    "kt": {
      "url": "http://mac-mini.TAILNET.ts.net:3847/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}
```

Replace `YOUR_TOKEN_HERE` with the token provided to you.
Replace `TAILNET` with the actual tailnet name.

3. Restart Claude Desktop

### 3. Verify

In any Claude conversation (Cowork or Claude Code), you should now see kt tools available. Try:
- "Search kt for Explicit Protocol"
- "What's in the kt knowledge base?"

## Usage

### Searching Knowledge
Ask Claude to search kt. Examples:
- "Search kt for brand strategy decisions"
- "What do we know about [topic]?"

### Capturing Knowledge
When you reach a meaningful insight or decision, ask Claude to capture it:
- "Capture this insight in kt under the explicit-protocol namespace"
- "Save this decision to our knowledge tracker"

### Browsing Context
Ask Claude to load the current knowledge context:
- "Load kt context for explicit-protocol"

## Namespaces

Your primary namespace is `explicit-protocol` (our shared company knowledge).
You can create your own namespaces too — just specify a different namespace when capturing.

## Tips

- Capture decisions and insights, not todo items or temporary notes
- Each capture should make sense on its own, without the conversation context
- Search before capturing to avoid duplicates
```

**Step 2: Commit**

```bash
git add docs/partner-onboarding.md
git commit -m "docs: add partner onboarding guide for kt MCP access"
```

## Task 9: Final Verification

**Step 1: Full build**

Run: `npm run build`
Expected: Clean compile, no errors

**Step 2: Full test suite**

Run: `npm test`
Expected: All tests pass

**Step 3: Manual smoke test**

```bash
# Create a test token
kt auth create-token smoketest

# Start server in background
kt serve --port 3847 &
SERVER_PID=$!

# Health check
curl http://localhost:3847/health
# Expected: {"status":"ok","service":"kt-mcp"}

# Test MCP endpoint (unauthenticated — should fail)
curl -X POST http://localhost:3847/mcp -H "Content-Type: application/json" -d '{}'
# Expected: 401

# Clean up
kill $SERVER_PID
kt auth revoke-token <the-token>
```

**Step 4: Commit any fixes, then tag**

```bash
git tag v0.3.0-mcp
```
