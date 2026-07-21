#!/usr/bin/env bash
# Install the apple-mcp HTTP server as a macOS LaunchAgent (user session).
#
# Usage:
#   MCP_AUTH_TOKEN=... MCP_READONLY_TOKEN=... PORT=3737 ./deploy/install-launchagent.sh
#
# Must run as a LaunchAgent (not a LaunchDaemon): AppleScript automation of
# Contacts/Messages/Mail requires the logged-in GUI session. First launch triggers
# macOS Automation permission prompts — approve them while logged in.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BUN="$(command -v bun)"
PORT="${PORT:-3737}"
LABEL="com.sicdigital.apple-mcp"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

: "${MCP_AUTH_TOKEN:?Set MCP_AUTH_TOKEN before running}"
: "${MCP_READONLY_TOKEN:?Set MCP_READONLY_TOKEN before running}"

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

sed \
	-e "s|__BUN__|$BUN|g" \
	-e "s|__REPO__|$REPO|g" \
	-e "s|__PORT__|$PORT|g" \
	-e "s|__FULL_TOKEN__|$MCP_AUTH_TOKEN|g" \
	-e "s|__READONLY_TOKEN__|$MCP_READONLY_TOKEN|g" \
	-e "s|__HOME__|$HOME|g" \
	"$REPO/deploy/com.sicdigital.apple-mcp.plist.template" > "$PLIST"

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "Loaded $LABEL. Logs: ~/Library/Logs/apple-mcp.{out,err}.log"
echo "Health: curl -s http://127.0.0.1:$PORT/healthz"
