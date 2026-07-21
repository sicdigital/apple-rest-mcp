# apple-rest-mcp — Usage Guide

How to run this server on a Mac and use it over your network from Hermes, a local
LLM, or any other service — via **MCP over HTTP** and a **read-only REST API**.

- [1. What you get](#1-what-you-get)
- [2. Requirements](#2-requirements)
- [3. Quick start](#3-quick-start)
- [4. Configuration](#4-configuration)
- [5. Authorization & token scopes](#5-authorization--token-scopes)
- [6. Connecting an MCP client (Hermes)](#6-connecting-an-mcp-client-hermes)
- [7. REST API reference](#7-rest-api-reference)
- [8. Running it persistently (launchd)](#8-running-it-persistently-launchd)
- [9. macOS permissions](#9-macos-permissions)
- [10. Security notes](#10-security-notes)
- [11. Troubleshooting](#11-troubleshooting)

---

## 1. What you get

Two transports over one authenticated HTTP server:

| Transport | Path | Who it's for | Can write? |
|-----------|------|--------------|------------|
| **MCP (Streamable HTTP)** | `POST /mcp` | Hermes / any MCP client | Yes (full token only) |
| **REST (read-only)** | `GET /api/v1/...` | Bulk reads, structured queries, ingestion | No (reads only) |

Plus stdio mode (unchanged) for Claude Desktop. The two modes are selected by the
`MCP_TRANSPORT` env var; `stdio` is the default.

Tools/domains exposed: **contacts, notes, messages, mail, reminders, calendar, maps**
(maps & messages are MCP-only; REST covers contacts/notes/mail/calendar/reminders).

---

## 2. Requirements

- macOS (drives Apple apps via AppleScript — macOS only).
- [Bun](https://bun.sh) installed (`brew install oven-sh/bun/bun`).
- The Apple apps you want to use, signed in and configured (Mail accounts, etc.).
- A logged-in GUI session (see [§9 permissions](#9-macos-permissions)).

Install dependencies once:

```bash
bun install
```

---

## 3. Quick start

Pick two tokens (any hard-to-guess strings) and start the server in HTTP mode:

```bash
MCP_TRANSPORT=http \
MCP_AUTH_TOKEN=full-$(openssl rand -hex 16) \
MCP_READONLY_TOKEN=read-$(openssl rand -hex 16) \
bun run index.ts
```

Or use the convenience script (still supply the tokens):

```bash
MCP_AUTH_TOKEN=... MCP_READONLY_TOKEN=... bun run http
```

You'll see:

```
apple-mcp HTTP server listening on http://0.0.0.0:3737
  MCP:  POST http://0.0.0.0:3737/mcp
  REST: GET  http://0.0.0.0:3737/api/v1/...
```

Verify it's up (no auth needed for health):

```bash
curl -s http://127.0.0.1:3737/healthz
# {"ok":true}
```

Copy `.env.example` to `.env` and edit if you prefer a file over inline env vars.

---

## 4. Configuration

All configuration is via environment variables.

| Var | Default | Purpose |
|-----|---------|---------|
| `MCP_TRANSPORT` | `stdio` | `stdio` (Claude Desktop) or `http` (network) |
| `HOST` | `0.0.0.0` | Bind address in http mode. Use `127.0.0.1` to restrict to localhost |
| `PORT` | `3737` | Listen port |
| `MCP_AUTH_TOKEN` | — | **Full-access** bearer token |
| `MCP_READONLY_TOKEN` | — | **Read-only** bearer token (give to Hermes) |

**Fail-closed:** in http mode the server refuses to start unless at least one token is
set, and the two tokens must be distinct. Setting only `MCP_READONLY_TOKEN` is valid and
yields a server where no network client can send mail/messages at all.

To move to another Mac (e.g. a dedicated Apple server), copy the repo, set the same env
vars, and run — nothing is hard-coded to a machine.

---

## 5. Authorization & token scopes

Every request (except `GET /healthz`) must include:

```
Authorization: Bearer <token>
```

The token you present determines the **scope**:

| Token | Scope | Allowed |
|-------|-------|---------|
| `MCP_AUTH_TOKEN` | `full` | Everything, including `mail:send`, `messages:send`, `messages:schedule` |
| `MCP_READONLY_TOKEN` | `read` | Everything **except** those three send/schedule operations |

Under the **read** scope, a blocked call returns a normal MCP tool error (not a crash):

```json
{ "content": [{ "type": "text",
  "text": "Operation messages:send is not permitted for this token (read-only)." }],
  "isError": true }
```

The read scope can still **read** mail and messages and can create notes, reminders, and
calendar events. The REST API is read-only for everyone regardless of scope.

**Give Hermes the `MCP_READONLY_TOKEN`.**

---

## 6. Connecting an MCP client (Hermes)

Point your MCP client at the `/mcp` endpoint with the token in an `Authorization`
header. Any MCP client that speaks **Streamable HTTP** works.

### Generic config

```
URL:     http://<your-mac-host>:3737/mcp
Header:  Authorization: Bearer <MCP_READONLY_TOKEN>
```

### TypeScript (official MCP SDK)

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("http://your-mac.local:3737/mcp"),
  { requestInit: { headers: { Authorization: "Bearer read-abc" } } },
);

const client = new Client({ name: "hermes", version: "1.0" }, { capabilities: {} });
await client.connect(transport);

console.log(await client.listTools());          // 7 tools
await client.callTool({ name: "mail", arguments: { operation: "latest", limit: 5 } });
```

### Raw JSON-RPC over curl (handshake sketch)

```bash
curl -sN http://127.0.0.1:3737/mcp \
  -H "Authorization: Bearer read-abc" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize",
       "params":{"protocolVersion":"2025-06-18","capabilities":{},
                 "clientInfo":{"name":"curl","version":"1"}}}'
```

(The SDK client handles the full initialize → tools/list → call flow for you; raw curl
is mainly useful for debugging connectivity/auth.)

---

## 7. REST API reference

Read-only. Base path `/api/v1`. Every response uses the same envelope:

```json
{ "data": [ /* items */ ],
  "pagination": { "limit": 100, "offset": 0, "count": 42 } }
```

Shared query params: `limit` (1–1000, default 100) and `offset` (default 0). All
requests need `Authorization: Bearer <token>`. Dates are ISO 8601.

### Contacts

```bash
# all contacts
curl -s -H "Authorization: Bearer $T" "http://127.0.0.1:3737/api/v1/contacts?limit=50"
# by name
curl -s -H "Authorization: Bearer $T" "http://127.0.0.1:3737/api/v1/contacts?name=Alice"
```
Item shape: `{ "name": "Alice", "phones": ["+1..."] }`

### Notes

| Param | Meaning |
|-------|---------|
| `folder` | Restrict to a Notes folder |
| `from`, `to` | ISO date range (**requires** `folder`) |
| `q` | Case-insensitive substring filter on title/content |

```bash
curl -s -H "Authorization: Bearer $T" "http://127.0.0.1:3737/api/v1/notes?q=budget&limit=20"
curl -s -H "Authorization: Bearer $T" "http://127.0.0.1:3737/api/v1/notes?folder=Work&from=2026-01-01&to=2026-06-30"
```
Item shape: `{ "name": "...", "content": "..." }`

### Mail

| Param | Meaning |
|-------|---------|
| `account` | Restrict to a Mail account (defaults to the first configured account for latest) |
| `unread=true` | Return unread mail instead of latest |
| `q` | Search term (searches mail) |

```bash
curl -s -H "Authorization: Bearer $T" "http://127.0.0.1:3737/api/v1/mail?limit=10"
curl -s -H "Authorization: Bearer $T" "http://127.0.0.1:3737/api/v1/mail?unread=true"
curl -s -H "Authorization: Bearer $T" "http://127.0.0.1:3737/api/v1/mail?q=invoice"
curl -s -H "Authorization: Bearer $T" "http://127.0.0.1:3737/api/v1/mail/accounts"
curl -s -H "Authorization: Bearer $T" "http://127.0.0.1:3737/api/v1/mail/mailboxes?account=iCloud"
```

### Calendar

| Param | Meaning |
|-------|---------|
| `q` | Search event titles/locations/notes |
| `from`, `to` | ISO date range |

```bash
curl -s -H "Authorization: Bearer $T" "http://127.0.0.1:3737/api/v1/calendar/events?limit=20"
curl -s -H "Authorization: Bearer $T" "http://127.0.0.1:3737/api/v1/calendar/events?q=standup&from=2026-07-01&to=2026-07-31"
```

### Reminders

Each reminder returns `name`, `id`, `listName`, `completed`, `dueDate`, and
`creationDate` (dates are AppleScript-localized strings, e.g.
`"Thursday, July 30, 2026 at 12:00:00 AM"`).

| Param | Meaning |
|-------|---------|
| `list` | Reminders list name |
| `listId` | Reminders list ID |
| `q` | Search term (matches the reminder name; includes completed) |
| `due[gte\|gt\|lte\|lt]` | Filter by **due date** (Stripe-style bracket operators, ISO 8601 values) |
| `created[gte\|gt\|lte\|lt]` | Filter by **creation date** (same operators) |

Date filters use Stripe-style bracket operators. `due` and `created` filter
independently and combine (AND). A reminder with no date on a filtered field is
excluded (most reminders have no `dueDate`, so prefer `created[...]` for "everything
in a window"). Invalid date values return `400`.

```bash
# plain list / search
curl -s -H "Authorization: Bearer $T" "http://127.0.0.1:3737/api/v1/reminders?limit=50"
curl -s -H "Authorization: Bearer $T" "http://127.0.0.1:3737/api/v1/reminders?q=dentist"

# created in June 2026 (bracket keys must be URL-encoded)
curl -s -H "Authorization: Bearer $T" \
  "http://127.0.0.1:3737/api/v1/reminders?created%5Bgte%5D=2026-06-01&created%5Blte%5D=2026-06-30"

# due before August 2026
curl -s -H "Authorization: Bearer $T" \
  "http://127.0.0.1:3737/api/v1/reminders?due%5Bgte%5D=2026-07-01&due%5Blt%5D=2026-08-01"
```

> ⚠️ Reminders queries are slow (~25–35s) — an AppleScript limitation, not the server.

> Tip: `export T=read-abc` once, then reuse `$T` in the examples above.

---

## 8. Running it persistently (launchd)

To keep the server running and auto-start it on login, install the bundled LaunchAgent:

```bash
MCP_AUTH_TOKEN=full-secret \
MCP_READONLY_TOKEN=read-secret \
PORT=3737 \
./deploy/install-launchagent.sh
```

This renders `deploy/com.sicdigital.apple-mcp.plist.template` into
`~/Library/LaunchAgents/com.sicdigital.apple-mcp.plist` and loads it. Logs go to:

- `~/Library/Logs/apple-mcp.out.log`
- `~/Library/Logs/apple-mcp.err.log`

Manage it:

```bash
launchctl unload ~/Library/LaunchAgents/com.sicdigital.apple-mcp.plist   # stop
launchctl load   ~/Library/LaunchAgents/com.sicdigital.apple-mcp.plist   # start
curl -s http://127.0.0.1:3737/healthz                                    # check
```

**It must be a LaunchAgent, not a LaunchDaemon** — see permissions below.

---

## 9. macOS permissions

The server drives Contacts, Notes, Messages, Mail, Reminders, and Calendar through
AppleScript, which requires the **logged-in GUI session** and TCC (Automation)
permission grants. Because of that:

- It runs as a **LaunchAgent** (user session), never a LaunchDaemon.
- On first use of each app you'll get a macOS **Automation** permission prompt
  ("… wants access to control …"). Approve them **once while logged in**.
- If a tool or REST endpoint returns empty results or an access error, the usual cause
  is a missing grant. Check **System Settings → Privacy & Security → Automation** (and
  the per-app privacy panes for Contacts, Calendar, Reminders).
- Messages read uses the local `chat.db`; you may also need **Full Disk Access** for the
  process running the server (e.g. your terminal, or `bun`) under
  **Privacy & Security → Full Disk Access**.

---

## 10. Security notes

- Anything that can reach `host:port` with a valid token can act as you (read contacts,
  read/send mail & messages with the full token). Treat the tokens like passwords.
- Keep the **full** token off any machine that only needs to read — hand out the
  **read-only** token by default (that's the whole point of the two-token design).
- The server binds to the LAN (`0.0.0.0`) by default. To restrict to the local machine,
  set `HOST=127.0.0.1`. To expose beyond the LAN, put it behind a reverse proxy — do not
  port-forward it raw.
- **TLS** is intentionally not built in. For encryption, front it with a reverse proxy
  (Caddy/nginx/Tailscale) terminating TLS; no code change needed.
- Rotate a token by changing the env var (or LaunchAgent plist) and restarting.

---

## 11. Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Server won't start: "requires MCP_AUTH_TOKEN and/or MCP_READONLY_TOKEN" | No token set in http mode. Set at least one. |
| Server won't start: "must be distinct" | The two tokens are identical. Use different values. |
| `401 {"error":"unauthorized"}` | Missing/wrong `Authorization: Bearer <token>` header. |
| REST returns `{"data":[],...}` (empty) | Missing macOS permission grant (see §9), or genuinely no data. |
| `messages:send`/`mail:send` returns "not permitted (read-only)" | You used the read-only token. Use the full token to send. |
| Port already in use | Another service holds the port. Change `PORT` (default `3737`). |
| `git push` "could not read Username" | GitHub credentials/PAT needed in your shell (unrelated to running the server). |
| SSH push: "REMOTE HOST IDENTIFICATION HAS CHANGED" | Stale/rotated github.com host key — verify the fingerprint before updating `known_hosts`. |

Health/liveness at any time: `curl -s http://127.0.0.1:<port>/healthz`.
