# 🍎 apple-rest-mcp

**Your Mac's native apps — Contacts, Notes, Messages, Mail, Reminders, Calendar, Maps —
exposed to AI over MCP _and_ a network REST API.**

A fork of [**dhravya/apple-mcp**](https://github.com/dhravya/apple-mcp), rebuilt to run as
a **networked service** so a self-hosted agent (e.g. Hermes) or a local LLM on another
machine can drive your Apple apps — with a read-only REST API for bulk/structured data
and per-token access scopes so agents can read without being able to send on your behalf.

---

## ✨ What's new in this fork

Everything the original does (stdio MCP for Claude Desktop) still works. On top of that:

- **🌐 MCP over HTTP (Streamable HTTP).** Run it as a LAN service and point any
  MCP-over-HTTP client (Hermes, local LLM, etc.) at `http://<mac>:3737/mcp` — not just a
  local stdio subprocess.
- **🔌 Read-only REST API** (`/api/v1/...`) for bulk reads and structured queries as clean
  JSON — ideal for ingesting/indexing contacts, notes, mail, calendar, and reminders.
- **🔑 Token scopes.** Two bearer tokens: a **full** token (can send mail/messages) and a
  **read-only** token that can read everything but cannot `mail:send` /
  `messages:send` / `messages:schedule`. Hand agents the read-only one.
- **🛡️ Fail-closed auth.** In network mode the server refuses to start without a token; every
  request needs `Authorization: Bearer …`.
- **♻️ Persistent service.** One-command macOS **LaunchAgent** install (auto-start + restart).
- **✅ Fixed Reminders.** Upstream could create reminders but **list/search silently returned
  nothing** (the query functions were stubs). Listing, searching, and by-list lookups now
  actually work — including for iCloud accounts.
- **📅 Reminders date filtering.** Filter by **due date** or **creation date** using
  Stripe-style bracket operators: `created[gte]=…&due[lt]=…`.

See [`docs/USAGE.md`](docs/USAGE.md) for the full guide.

---

## 🤯 What it can do

### 💬 Messages
Send, read, schedule messages, and check unread. *(Sending requires the full token.)*

### 📝 Notes
Create, list, and search notes; pull a folder or a date range.

### 👥 Contacts
Look up contacts by name or list them all with phone numbers.

### 📧 Mail
Read unread/latest, search, list accounts & mailboxes, and send (full token). CC/BCC supported.

### ⏰ Reminders
List and search reminders, get a list's reminders by id, create new ones, and **filter by
due or creation date**. *(List/search were broken upstream — fixed here.)*

### 📅 Calendar
Search, list, create, and open events; filter by date range.

### 🗺️ Maps
Search locations, save favorites, get directions, drop pins, and manage guides.

### 🎭 Chaining still just works
_"Read my conference notes, find contacts for the people I met, and send them a thank-you
message"_ runs across notes → contacts → messages in one request.

---

## 🚀 Getting started

Requires macOS and [Bun](https://bun.sh) (`brew install oven-sh/bun/bun`).

```bash
git clone https://github.com/sicdigital/apple-rest-mcp.git
cd apple-rest-mcp
bun install
```

There are two ways to run it:

### A) Local stdio (Claude Desktop)

Add to `claude_desktop_config.json` — points Claude Desktop at your local checkout:

```json
{
  "mcpServers": {
    "apple-mcp": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/apple-rest-mcp/index.ts"]
    }
  }
}
```

### B) Network mode (agents / other machines) — the point of this fork

```bash
MCP_AUTH_TOKEN=full-secret MCP_READONLY_TOKEN=read-secret bun run http
```

Then point your agent at `http://<this-mac>:3737/mcp` with
`Authorization: Bearer <read-secret>`. Details below.

---

## 🌐 Network mode (MCP over HTTP + read-only REST API)

> 📖 Full guide — per-endpoint examples, MCP client setup, launchd, permissions, and
> troubleshooting — in [`docs/USAGE.md`](docs/USAGE.md). This is the short version.

### Run it

```bash
# inline tokens
MCP_AUTH_TOKEN=full-secret MCP_READONLY_TOKEN=read-secret bun run http

# or with an env file (see .env.example)
```

### Configuration (env vars)

| Var | Default | Purpose |
|-----|---------|---------|
| `MCP_TRANSPORT` | `stdio` | Set to `http` for network mode (`bun run http` does this) |
| `HOST` | `0.0.0.0` | Bind address (http mode) |
| `PORT` | `3737` | Listen port |
| `MCP_AUTH_TOKEN` | — | **Full-access** bearer token (all operations, incl. sending) |
| `MCP_READONLY_TOKEN` | — | **Read-only** bearer token — give this one to your agent |

In http mode at least one token must be set or the server refuses to start
(fail-closed). Tokens must be distinct.

### Authorization scopes

Every request needs `Authorization: Bearer <token>`. The token decides the scope:

- **Full token** → all tools/operations.
- **Read-only token** → everything **except** `mail:send`, `messages:send`, and
  `messages:schedule`. It can still read mail/messages and create
  notes/reminders/calendar events. Blocked calls return a tool error, not a crash.

### Endpoints

- `POST /mcp` — MCP Streamable HTTP. Point your agent here:
  `http://<host>:3737/mcp` with `Authorization: Bearer <MCP_READONLY_TOKEN>`.
- `GET /healthz` — liveness, no auth.
- `GET /openapi.yaml` — OpenAPI 3.1 spec for the REST API, no auth ([`openapi.yaml`](openapi.yaml)).
- `GET /api/v1/contacts?name=&limit=&offset=`
- `GET /api/v1/notes?folder=&from=&to=&q=&limit=&offset=`
- `GET /api/v1/mail?account=&unread=&q=&limit=&offset=`, `/api/v1/mail/accounts`, `/api/v1/mail/mailboxes?account=`
- `GET /api/v1/calendar/events?q=&from=&to=&limit=&offset=`
- `GET /api/v1/reminders?list=&listId=&q=&limit=&offset=` — plus Stripe-style date filters
  `created[gte|gt|lte|lt]=<iso>` and `due[gte|gt|lte|lt]=<iso>`

The REST API is **read-only** for all callers; all writes go through MCP.

### Keep it running (macOS LaunchAgent)

```bash
MCP_AUTH_TOKEN=full-secret MCP_READONLY_TOKEN=read-secret PORT=3737 \
  ./deploy/install-launchagent.sh
```

⚠️ **Permissions:** the server drives Apple apps via AppleScript, which needs the
logged-in GUI session. It's installed as a **LaunchAgent** (not a LaunchDaemon) for
this reason. The first launch triggers macOS **Automation** permission prompts for
Contacts, Messages, Mail, Reminders, and Calendar — approve them once while logged
in, or tools will silently return empty/errors.

> ⚠️ **Note:** Reminders queries are slow (~25–35s) — an AppleScript limitation, not the server.

---

## 🎯 Example prompts

```
"Send a message to mom saying I'll be late for dinner"
"Find all my AI research notes and email them to sarah@company.com"
"Create a reminder to call the dentist tomorrow at 2pm"
"Show me my calendar for next week and add coffee with Alex on Friday"
"Find the nearest pizza place and save it to my favorites"
```

---

## 🙏 Credits

Originally created by [Dhravya Shah](https://dhravya.dev) / [supermemory](https://supermemory.ai)
as [apple-mcp](https://github.com/dhravya/apple-mcp). This fork adds network HTTP + REST,
token scopes, persistent deployment, and the Reminders fixes described above.
