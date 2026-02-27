# kt MCP Server: Multi-User Access via Shared Server

**Date:** 2026-02-27
**Status:** Approved
**Goal:** Enable business partner to use kt from her Mac via Claude Desktop (Cowork + Claude Code)

## Context

kt is currently a single-user CLI tool with a local SQLite database at `~/.kt/kt.db`. It's installed via `npm link` from a local git clone, with hooks and skills configured in the developer's Claude Code settings.

The business partner needs to capture and search knowledge in the "Explicit Protocol" namespace (shared company). She uses Claude Desktop on macOS with both Cowork and Claude Code.

## Decision: MCP Server on Mac Mini

**Chosen approach:** Build kt as an MCP server running on the existing Mac Mini infrastructure. The partner connects via streamable HTTP transport from Claude Desktop.

**Why MCP:**
- Native integration for Claude Desktop (works in both Cowork and Claude Code)
- Zero install on partner's machine (just an MCP config entry)
- kt's operations map cleanly to MCP tools
- Future access control fits naturally at the MCP layer

**Rejected alternatives:**
- **HTTP API + remote CLI:** More moving parts, partner needs local kt install, no Cowork integration
- **SSH/SSHFS + shared database:** SQLite over network mounts is fragile, no Cowork integration
- **iCloud sync:** SQLite + cloud sync has known corruption risks

## Architecture

```
Partner's Mac (Claude Desktop)
  └─ MCP client (streamable-http)
       └─ Tailscale tunnel (WireGuard encrypted)
            └─ Mac Mini:3847/mcp
                 └─ kt MCP server (Node.js)
                      └─ kt core library → SQLite (~/.kt/kt.db)

Developer's MacBook Air / Mac Mini (Claude Code)
  └─ Local kt CLI (unchanged)
  └─ Optionally: same MCP server
```

## MCP Tools

| Tool | Parameters | Maps to |
|------|-----------|---------|
| `kt_search` | query, namespace? | `kt search "<query>" --namespace <ns>` |
| `kt_capture` | content, title, namespace? | `kt capture "<content>" --title "<title>" --namespace <ns>` |
| `kt_context` | namespace? | `kt context --namespace <ns> --format json` |
| `kt_show` | id | `kt show <id>` |
| `kt_list_namespaces` | (none) | List available namespaces |

## Network & Security

### Tailscale (replaces NordVPN Meshnet for this use case)

- Install Tailscale on Mac Mini and partner's Mac
- Both join the same tailnet (developer as admin)
- Mac Mini gets stable DNS: `mac-mini.<tailnet>.ts.net`
- MCP server binds to Tailscale interface only (not public)
- HTTP within Tailscale is fine (tunnel is WireGuard-encrypted E2E)

### Authentication

- Bearer token auth on the MCP server
- Tokens stored in `~/.kt/auth.json` on Mac Mini
- Each token maps to a user identifier
- Start with one token per user, expand to namespace-scoped permissions later

```json
// ~/.kt/auth.json
{
  "tokens": {
    "tok_abc123...": { "user": "partner", "created": "2026-02-27" },
    "tok_def456...": { "user": "developer", "created": "2026-02-27" }
  }
}
```

### Partner's MCP Config

Added to her `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kt": {
      "url": "http://mac-mini.<tailnet>.ts.net:3847/mcp",
      "headers": {
        "Authorization": "Bearer tok_abc123..."
      }
    }
  }
}
```

## Implementation Scope

### 1. kt MCP server (`src/mcp/`)

- Uses `@modelcontextprotocol/sdk` (official TypeScript SDK)
- Imports kt core modules directly (search, capture, context, show)
- Streamable HTTP transport for Claude Desktop compatibility
- Bearer token auth middleware
- New CLI command: `kt serve --port 3847 [--host 0.0.0.0]`

### 2. Token management

- Config file at `~/.kt/auth.json`
- CLI commands: `kt auth create-token <user>`, `kt auth list-tokens`, `kt auth revoke-token <token>`
- Middleware validates bearer token on every request

### 3. Tailscale setup (ops task, not code)

- Install Tailscale on Mac Mini
- Install Tailscale on partner's Mac
- Configure tailnet, verify connectivity
- Optional: Tailscale ACLs for port restriction

### 4. Partner onboarding

- Install Tailscale, join tailnet
- Add MCP config entry
- Test: search, capture, context from Claude Desktop

### What stays unchanged

- Local CLI workflow
- Existing hooks and skills
- Database schema
- Namespace system
- MacBook Air SSH-based MCP pattern (until Tailscale migration)

## Future: Namespace Access Control

Not in scope for v1, but the auth layer is designed to support it:

```json
{
  "tokens": {
    "tok_abc123...": {
      "user": "partner",
      "namespaces": ["explicit-protocol"],
      "permissions": ["read", "write"]
    }
  }
}
```

## Follow-Up: Tailscale Migration (Separate Task)

The developer currently uses NordVPN Meshnet for Mac Mini access (RAG system, remote MCPs via SSH, VS Code Remote). A separate task should migrate all infrastructure from Meshnet to Tailscale for consistency:

**Scope of migration:**
- Install Tailscale on MacBook Air (alongside or replacing NordVPN)
- Update SSH config: `igor-dom.nord` → `mac-mini.<tailnet>.ts.net`
- Update remote MCP configs in `~/.claude.json` (chroma, playwright, browser)
- Update RAG health check endpoints in agent docs
- Update `infrastructure-macbook-air.md` and `infrastructure-mac-mini.md`
- Verify all existing remote workflows function over Tailscale
- Optionally decommission NordVPN Meshnet (keep NordVPN VPN if needed for privacy)

**Note:** This is independent of the kt MCP server work and can be done before, after, or in parallel. The kt MCP server will use Tailscale from day one; the migration covers existing infrastructure.
