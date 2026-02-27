# Meshnet to Tailscale Migration Plan

**Date:** 2026-02-27
**Status:** Draft
**Goal:** Replace NordVPN Meshnet with Tailscale as the networking layer between MacBook Air and Mac Mini, covering SSH, remote MCPs, RAG, and all tooling.

## Why Migrate

- Tailscale has a free tier — needed for partner access to kt MCP server (see `2026-02-27-kt-mcp-server-design.md`)
- Industry standard for mesh VPN, purpose-built for this use case
- Coexists with NordVPN (keep NordVPN for privacy VPN, drop Meshnet)
- Magic DNS gives stable hostnames without manual config

## Current State: What Uses Meshnet

### Functional (these break if Meshnet goes away)

| Category | What | How | File |
|----------|------|-----|------|
| **SSH alias** | `ssh macmini` | Resolves `igor-dom.nord` | `~/.ssh/config` |
| **MCP: chroma** | RAG vector search | SSH to macmini | `~/.claude.json` |
| **MCP: browser** | Browser automation | SSH to macmini | `~/.claude.json` |
| **MCP: playwright** | Browser testing | SSH to macmini | `~/.config/zed/settings.json` |
| **MCP: ai-wiki** | Wiki server | SSH to macmini | `~/.config/zed/settings.json` |
| **MCP: granola-mcp** | Meeting notes | SSH to macmini | `~/.config/zed/settings.json` |
| **Zed SSH** | Remote editing | `igor-dom.nord` direct | `~/.config/zed/settings.json` |
| **RAG health** | Health check endpoint | `http://igor-dom.nord:8000/health` | agent docs, skills |
| **Shell: rag()** | Quick RAG search | `ssh macmini` | `~/.zshrc` |
| **Shell: claude-local()** | Ollama tunnel | `ssh macmini` | `~/.zshrc` |
| **Shell: ghostly()** | Claudechic remote | `ssh igor-dom.nord` | `~/.zshrc` |
| **Shell: cc-new/list/attach** | Remote Claude sessions | `ssh igor-dom.nord` | `~/.zshrc` |
| **~/bin scripts** | 7 scripts for remote tmux/Claude | `ssh macmini` | `~/bin/` |
| **Screenshot handler** | Remote screenshot relay | `REMOTE_HOST="macmini"` | `~/bin/screenshot-handler.sh` |

### Documentation-only (update for accuracy, not functional)

| File | References |
|------|-----------|
| `~/.claude/hooks/session-start.sh` | Label string "Mac Mini (igor-dom.nord)" |
| `~/.claude/agent_docs/infrastructure-macbook-air.md` | Meshnet references, igor-dom.nord |
| `~/.claude/agent_docs/infrastructure-mac-mini.md` | igor-dom.nord label |
| `~/.claude/agent_docs/remote-mcp-troubleshooting.md` | ssh macmini examples (~30) |
| `~/.claude/agent_docs/mcp-installation-guide.md` | Example config |
| `~/GitHub/dotfiles/TERMIUS.md` | igor-dom.nord, Meshnet IP |

### Dotfiles/Bootstrap (source of truth for deploy)

| File | What |
|------|------|
| `~/GitHub/dotfiles/macbook-air-bootstrap/scripts/03-ssh-config.sh` | Writes `igor-dom.nord` into SSH config |
| `~/GitHub/dotfiles/macbook-air-bootstrap/scripts/04-claude-config.sh` | Writes macmini MCP entries |
| `~/GitHub/dotfiles/macbook-air-bootstrap/verify/verify.sh` | Tests `ssh macmini` connectivity |
| `~/GitHub/dotfiles/macbook-air-bootstrap/config/brewfile.txt` | `--cask nordvpn` |
| `~/GitHub/dotfiles/claude/commands/*.md` | update-macmini, sync-mcp, etc. |
| `~/GitHub/dotfiles/claude/skills/*/SKILL.md` | pdf-extract, whatsapp, machine-specific-dotfiles-sync |

## Migration Strategy

### Key Insight: The SSH alias is a chokepoint

Almost everything goes through `ssh macmini`, which resolves via `~/.ssh/config` to `igor-dom.nord`. If we change that one hostname, ~80% of the migration is done. The remaining 20% is places that hardcode `igor-dom.nord` directly.

### Tailscale Hostname

After installing Tailscale, the Mac Mini gets a magic DNS name: `mac-mini.<tailnet>.ts.net`

We'll use this as the new `HostName` in SSH config. The `macmini` alias stays the same — everything that uses `ssh macmini` works without changes.

## Tasks

### Task 1: Install Tailscale on Mac Mini

**Ops task — no code changes.**

1. SSH into Mac Mini: `ssh macmini`
2. Install Tailscale: `brew install --cask tailscale`
3. Start Tailscale and authenticate: `open -a Tailscale` → sign in via browser
4. Note the assigned hostname and IP: `tailscale status`
5. Verify Mac Mini is accessible: from another Tailscale device, `ping mac-mini.<tailnet>.ts.net`

### Task 2: Install Tailscale on MacBook Air

**Ops task — no code changes.**

1. Install: `brew install --cask tailscale`
2. Start and authenticate with same Tailscale account
3. Verify connectivity: `ping mac-mini.<tailnet>.ts.net`
4. Test SSH directly: `ssh zeigor@mac-mini.<tailnet>.ts.net`

### Task 3: Update SSH Config (the chokepoint)

**File:** `~/.ssh/config`

Change:
```
Host macmini
    HostName igor-dom.nord
    User zeigor
    IdentityFile ~/.ssh/id_ed25519
```

To:
```
Host macmini
    HostName mac-mini.<tailnet>.ts.net
    User zeigor
    IdentityFile ~/.ssh/id_ed25519
```

**Verify:** `ssh macmini` still connects.

This single change fixes: all MCP servers in `~/.claude.json`, all `~/bin/` scripts, `rag()` function, `claude-local()`, `screenshot-handler.sh`, and everything else that uses the `macmini` alias.

### Task 4: Fix Direct igor-dom.nord References in Shell Config

**File:** `~/.zshrc`

Find and replace `igor-dom.nord` with `macmini` (use the SSH alias instead of direct hostname):

| Function | Current | Change to |
|----------|---------|-----------|
| `ghostly()` | `ssh -t igor-dom.nord '...'` | `ssh -t macmini '...'` |
| `cc-new()` | `ssh igor-dom.nord ...` | `ssh macmini ...` |
| `cc-list()` | `ssh igor-dom.nord ...` | `ssh macmini ...` |
| `cc-attach()` | `ssh igor-dom.nord ...` | `ssh macmini ...` |

**Verify:** Each function still works after the change.

### Task 5: Fix Direct igor-dom.nord in ~/bin Scripts

**File:** `~/bin/claudechic-remote-backup`

Replace `igor-dom.nord` with `macmini`.

**Verify:** Script still connects.

### Task 6: Fix Zed Editor Config

**File:** `~/.config/zed/settings.json`

Change the SSH connection hostname:
```json
"ssh_connections": [{ "host": "mac-mini.<tailnet>.ts.net", "args": [], "projects": [] }]
```

**Verify:** Zed remote connection to Mac Mini works.

### Task 7: Update RAG Health Check Endpoints

These reference `igor-dom.nord:8000` directly (not via SSH):

**Files to update:**
- `~/GitHub/dotfiles/claude/commands/update-macmini.md` — change `igor-dom.nord:8000` to `mac-mini.<tailnet>.ts.net:8000`
- `~/GitHub/dotfiles/claude/commands/update-macmini-review.md` — same
- `~/GitHub/dotfiles/claude/skills/whatsapp/SKILL.md` — if it references RAG endpoint
- `~/GitHub/dotfiles/claude/skills/machine-specific-dotfiles-sync/SKILL.md` — update endpoint references

**Verify:** `curl -H 'X-API-Key: rag_key_for_local_network_2025' http://mac-mini.<tailnet>.ts.net:8000/health`

### Task 8: Update Agent Docs

**Files:**
- `~/.claude/agent_docs/infrastructure-macbook-air.md` — replace all Meshnet references with Tailscale, update hostname, update RAG health check
- `~/.claude/agent_docs/infrastructure-mac-mini.md` — update hostname label
- `~/.claude/agent_docs/remote-mcp-troubleshooting.md` — update any hardcoded hostnames (the `ssh macmini` references are fine as-is)

### Task 9: Update Dotfiles Bootstrap Scripts

**Files:**
- `~/GitHub/dotfiles/macbook-air-bootstrap/scripts/03-ssh-config.sh` — write Tailscale hostname instead of `igor-dom.nord`
- `~/GitHub/dotfiles/macbook-air-bootstrap/config/brewfile.txt` — add `--cask tailscale`, keep `--cask nordvpn` if still wanted for privacy VPN
- `~/GitHub/dotfiles/macbook-air-bootstrap/verify/verify.sh` — update connectivity checks if needed
- `~/GitHub/dotfiles/macbook-air-bootstrap/templates/claude/agent_docs/infrastructure-macbook-air.md` — update template

### Task 10: Update Dotfiles Documentation

**Files:**
- `~/GitHub/dotfiles/TERMIUS.md` — update hostname, remove Meshnet IP, add Tailscale details
- `~/GitHub/dotfiles/claude/hooks/session-start.sh` — update label string

### Task 11: Deploy and Verify

1. Run `~/GitHub/dotfiles/deploy.sh` on MacBook Air
2. Verify full stack:
   - `ssh macmini` connects
   - Claude Code MCPs work (chroma, browser)
   - `rag()` shell function works
   - `claude-local()` Ollama tunnel works
   - Zed remote editing works
   - RAG health check responds
   - `ghostly()`, `cc-new()`, `cc-list()`, `cc-attach()` all work
3. Run a Claude Code session and verify session-start hook loads kt context

### Task 12: (Optional) Disable NordVPN Meshnet

Once everything is verified on Tailscale:

1. Open NordVPN settings → Meshnet → Disable
2. Keep NordVPN installed for privacy VPN if desired
3. Remove `igor-dom.nord` references from any remaining configs

## Rollback

If Tailscale has issues, revert SSH config `HostName` back to `igor-dom.nord` and re-enable Meshnet. The `macmini` alias pattern means rollback is a one-line change.

## Sequencing Note

This migration is independent of the kt MCP server work. The kt MCP server will use Tailscale from day one (Task 7 of the MCP server plan). This migration covers existing infrastructure.

Recommended order: **Tailscale migration first**, then kt MCP server. That way the Mac Mini is fully on Tailscale before adding new services.
