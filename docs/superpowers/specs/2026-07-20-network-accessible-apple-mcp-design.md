# Design: Network-Accessible apple-mcp (MCP over HTTP + Read REST API)

**Date:** 2026-07-20
**Status:** Approved (pending spec review)

## Goal

Make the `apple-mcp` server reachable over the local network so a Hermes agent, a
local LLM, and other LAN services can use it. The server drives native macOS apps
(Contacts, Notes, Messages, Mail, Reminders, Calendar, Maps) via AppleScript/JXA and
must keep running persistently on a Mac (this machine now, or a dedicated Apple server
on the network later).

Two consumption paths are required:

1. **MCP over HTTP** — Hermes speaks MCP natively (Streamable HTTP). Full tool set,
   including writes (send message/email, create note/reminder/event).
2. **Read-only REST API** — for bulk reads/exports and structured queries that Hermes
   uses to ingest/index data as clean JSON.

## Non-Goals (YAGNI)

- No REST **write** endpoints and no batch-write API. All writes stay MCP-only.
- No TLS in-app (LAN + bearer token is the chosen security posture; TLS can be added
  later via a reverse proxy with zero code changes).
- No Docker (macOS containers cannot drive Apple apps, which need the host GUI session).
- No REST endpoints for `maps` or `messages` (they remain available via MCP).

## Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Client transport | Native MCP over HTTP (Streamable HTTP, SDK `^1.5.0`) |
| Security | LAN bind + static bearer token, fail-closed if token unset |
| Process management | macOS **LaunchAgent** (user GUI session), auto-start + KeepAlive |
| REST shape | Read-only: bulk reads/exports + structured queries/filters |
| REST domains | contacts, notes, mail, calendar, reminders |
| Default port | `3737` (overridable via `PORT`) |
| Approach | Add HTTP transport in-process; keep stdio path unchanged |

## Architecture

### Transport switch

`index.ts` selects transport from `MCP_TRANSPORT`:

- `stdio` (default) — current behavior, unchanged. The `.dxt` / Claude Desktop install
  keeps working exactly as today.
- `http` — starts one Hono HTTP server (via `@hono/node-server`, already a dependency)
  hosting **both** the MCP endpoint and the REST API on a single port behind one auth
  layer.

Both transports reuse the **same** configured MCP `Server` instance via a new
`createMcpServer()` factory.

### Targeted refactor

Today `new Server(...)` plus every `setRequestHandler(...)` call lives inside
`initServer()` in `index.ts` (~1700 lines). Extract that setup into a
`createMcpServer()` factory so both the stdio and HTTP paths reuse identical tool
wiring. This is the only structural change to existing code — **tool logic is not
modified**. It carves a clean, reusable boundary out of an oversized file.

### Module boundaries (new files)

```
index.ts                # transport switch: stdio (default) or http
mcp/create-server.ts    # createMcpServer(): builds Server + registers all handlers
http/server.ts          # builds Hono app, mounts middleware/routes, starts listener
http/auth.ts            # bearer-token middleware (constant-time compare)
http/mcp.ts             # StreamableHTTPServerTransport wired at /mcp (session-managed)
http/rest/contacts.ts   # GET read endpoints, call utils/contacts
http/rest/notes.ts      # GET read endpoints, call utils/notes
http/rest/mail.ts       # GET read endpoints, call utils/mail
http/rest/calendar.ts   # GET read endpoints, call utils/calendar
http/rest/reminders.ts  # GET read endpoints, call utils/reminders
http/rest/pagination.ts # shared limit/offset + JSON envelope helper
```

Each REST handler is a thin wrapper over existing `utils/*` functions — no new
AppleScript unless a filter genuinely needs it.

## Configuration (env)

| Var | Default | Notes |
|-----|---------|-------|
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `HOST` | `0.0.0.0` (http mode) | Bind address |
| `PORT` | `3737` | Listen port |
| `MCP_AUTH_TOKEN` | *(none)* | **Required** in http mode; server refuses to start without it |

Porting to the future Apple server = copy repo, set the same env, run. A `.env.example`
and README section document all variables.

## Security

- `http/auth.ts` requires `Authorization: Bearer <MCP_AUTH_TOKEN>` on every request
  except `GET /healthz`.
- Constant-time token comparison.
- **Fail closed:** in http mode, if `MCP_AUTH_TOKEN` is unset/empty the server logs an
  error and exits rather than serving unauthenticated. Anything that reaches this server
  can act as the user (send mail, read contacts), so an unauthenticated network listener
  is never started.
- Binds to the LAN; TLS intentionally deferred to an optional external reverse proxy.

## REST API (read-only, `/api/v1`)

Consistent JSON envelope and shared pagination:

```json
{ "data": [ ... ], "pagination": { "limit": 50, "offset": 0, "count": 50 } }
```

Shared query params: `limit`, `offset`. Endpoints:

| Method & path | Filters | Backed by |
|---------------|---------|-----------|
| `GET /api/v1/contacts` | `name` | `contacts.getAllNumbers` / `findNumber` |
| `GET /api/v1/notes` | `folder`, `from`, `to`, `q` | `notes.getAllNotes` / `getNotesFromFolder` / `getNotesByDateRange` / `findNote` |
| `GET /api/v1/mail` | `account`, `mailbox`, `unread`, `q`, `from`, `to` | `mail.getLatestMails` / `getUnreadMails` / `searchMails` |
| `GET /api/v1/mail/mailboxes` | `account` | `mail.getMailboxes` / `getMailboxesForAccount` |
| `GET /api/v1/mail/accounts` | — | `mail.getAccounts` |
| `GET /api/v1/calendar/events` | `from`, `to`, `q` | calendar list/search |
| `GET /api/v1/reminders` | `list`, `listId`, `q` | `reminders.getAllReminders` / `getRemindersFromListById` / `searchReminders` |
| `GET /healthz` | — (no auth) | liveness for launchd/monitoring |

Dates use ISO 8601. Filtering that the underlying util already supports is delegated;
where a util returns a full set, the REST layer applies `q`/pagination in-process.

## MCP endpoint (`/mcp`)

- SDK `StreamableHTTPServerTransport`, session-managed (per-session transport keyed by
  the `mcp-session-id` header), backed by `createMcpServer()`.
- Handles `POST` (JSON-RPC), `GET` (server-initiated stream), `DELETE` (session close).
- Full tool set, including writes. This is the only network path that can write.

## Process management — LaunchAgent

`~/Library/LaunchAgents/com.sicdigital.apple-mcp.plist`:

- Runs `bun run <repo>/index.ts` with `MCP_TRANSPORT=http`, `PORT`, `MCP_AUTH_TOKEN`, etc.
- `RunAtLoad=true`, `KeepAlive=true` (restart on crash).
- `StandardOutPath` / `StandardErrorPath` to a log file under `~/Library/Logs/`.

**Constraint — must be a LaunchAgent, not a LaunchDaemon:** AppleScript automation of
Contacts/Messages/Mail requires the logged-in GUI session and TCC (Automation) grants.
A LaunchDaemon runs outside the user session and cannot drive these apps. First startup
triggers macOS Automation permission prompts that must be approved once while logged in;
this is documented in the README with the exact apps to expect.

## Error handling

- Auth failures → `401` with a JSON error body.
- Unknown route → `404`; validation failure (bad date, bad `limit`) → `400`.
- Util/AppleScript errors → `500` with a safe message; full detail to the log, not the
  response body. Existing `try/catch` conventions in `utils/*` are preserved.

## Testing

Extend the existing `tests/` harness (adds `tests/http/`):

- Auth: `401` with no token / wrong token; `200` with correct token; `/healthz` needs no auth.
- One REST read per domain with `utils/*` mocked (envelope shape, pagination, filters).
- MCP-over-HTTP initialize handshake succeeds and `tools/list` returns the 7 tools.
- Validation: bad `from`/`to` → `400`.

Existing stdio and integration tests remain untouched and passing.

## Rollout

1. Refactor `createMcpServer()` factory; verify stdio mode still works (regression).
2. Add `http/` server, auth, MCP route; verify Hermes connects over HTTP with token.
3. Add REST read endpoints per domain.
4. Add LaunchAgent plist + README/`.env.example` docs.
5. Install LaunchAgent, grant Automation permissions, verify persistence across reboot.
