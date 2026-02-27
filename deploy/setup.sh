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
