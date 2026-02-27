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
