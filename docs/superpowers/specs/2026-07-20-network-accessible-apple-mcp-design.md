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
| Client transport | Native MCP over HTTP (Streamable HTTP). **Requires SDK upgrade** `1.5.0` → latest `1.x` (`1.29.0`); 1.5.0 has no `StreamableHTTPServerTransport` |
| Security | LAN bind + bearer token; **two scopes** (full / read-only); fail-closed if no token set |
| Authorization | Per-client token scopes. Hermes uses the read-only token |
| Read-only scope blocks | `mail:send`, `messages:send`, `messages:schedule` (only). Notes/reminders/calendar creation still allowed |
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
| `MCP_AUTH_TOKEN` | *(none)* | **Full-access** bearer token (all operations) |
| `MCP_READONLY_TOKEN` | *(none)* | **Read-only** bearer token. This is the one Hermes uses |

In http mode **at least one** token must be set or the server refuses to start
(fail closed). Setting only `MCP_READONLY_TOKEN` is valid — it yields a network
surface where no client can send mail/messages. Tokens must be distinct.

Porting to the future Apple server = copy repo, set the same env, run. A `.env.example`
and README section document all variables.

## Security

- `http/auth.ts` requires `Authorization: Bearer <token>` on every request except
  `GET /healthz`. It resolves the presented token to a **scope**:
  `MCP_AUTH_TOKEN` → `full`, `MCP_READONLY_TOKEN` → `read`. Unknown token → `401`.
- Constant-time token comparison against each configured token.
- **Fail closed:** in http mode, if neither token is set the server logs an error and
  exits rather than serving unauthenticated. Anything that reaches this server can act
  as the user (send mail, read contacts), so an unauthenticated listener is never started.
- Binds to the LAN; TLS intentionally deferred to an optional external reverse proxy.

## Authorization scopes (write-blocking)

Writes here are *operations inside* tools, not standalone tools, so blocking happens at
the operation level — never by hiding a tool (which would also remove its read ops).

- The auth layer attaches the resolved scope (`full` | `read`) to the request/session.
- When an MCP session is established, its scope is captured and the MCP call handler
  enforces it. The **read** scope rejects exactly: `mail:send`, `messages:send`,
  `messages:schedule`. A blocked call returns an MCP tool error
  (`"operation X is not permitted for this token (read-only)"`), not a crash.
- All other operations — including `notes:create`, `reminders:create`,
  `calendar:create`, and every read — are allowed under both scopes.
- `createMcpServer({ allowMessaging })` centralizes the guard so the same list is
  enforced regardless of transport; `allowMessaging` is `false` for the read scope.
- The full REST API is read-only for all callers regardless of scope, so no REST-side
  scope logic is needed.

Hermes is configured with `MCP_READONLY_TOKEN`: it can read mail and messages (and
create notes/reminders/events) but cannot send mail or send/schedule messages.

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
  the `mcp-session-id` header). Each session is built via
  `createMcpServer({ allowMessaging })` where `allowMessaging` comes from the token
  scope that opened the session.
- Handles `POST` (JSON-RPC), `GET` (server-initiated stream), `DELETE` (session close).
- Full tool set is exposed to all clients; the read scope rejects the three
  send/schedule operations at call time (see Authorization scopes). This is the only
  network path that can write at all.

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

- Auth: `401` with no token / wrong token; `200` with either valid token; `/healthz` needs no auth.
- Scope: read-only token → `mail:send` / `messages:send` / `messages:schedule` return a
  tool error; the same operations succeed (mocked) under the full token; reads and
  `notes:create` succeed under both.
- Fail-closed: http mode with no token configured exits at startup.
- One REST read per domain with `utils/*` mocked (envelope shape, pagination, filters).
- MCP-over-HTTP initialize handshake succeeds and `tools/list` returns the 7 tools.
- Validation: bad `from`/`to` → `400`.

Existing stdio and integration tests remain untouched and passing.

## Rollout

1. Refactor `createMcpServer()` factory; verify stdio mode still works (regression).
2. Add `http/` server, scoped auth (full/read tokens), and MCP route with the
   `allowMessaging` guard; verify Hermes connects with the read token and that
   `mail:send` / `messages:send` are rejected while reads work.
3. Add REST read endpoints per domain.
4. Add LaunchAgent plist + README/`.env.example` docs.
5. Install LaunchAgent, grant Automation permissions, verify persistence across reboot.
