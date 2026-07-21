# 🍎 Apple MCP - Better Siri that can do it all :)

> **Plot twist:** Your Mac can do more than just look pretty. Turn your Apple apps into AI superpowers!

Love this MCP? Check out supermemory MCP too - https://mcp.supermemory.ai


Click below for one click install with `.dxt`

<a href="https://github.com/supermemoryai/apple-mcp/releases/download/1.0.0/apple-mcp.dxt">
  <img  width="280" alt="Install with Claude DXT" src="https://github.com/user-attachments/assets/9b0fa2a0-a954-41ee-ac9e-da6e63fc0881" />
</a>

[![smithery badge](https://smithery.ai/badge/@Dhravya/apple-mcp)](https://smithery.ai/server/@Dhravya/apple-mcp)


<a href="https://glama.ai/mcp/servers/gq2qg6kxtu">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/gq2qg6kxtu/badge" alt="Apple Server MCP server" />
</a>

## 🤯 What Can This Thing Do?

**Basically everything you wish your Mac could do automatically (but never bothered to set up):**

### 💬 **Messages** - Because who has time to text manually?

- Send messages to anyone in your contacts (even that person you've been avoiding)
- Read your messages (finally catch up on those group chats)
- Schedule messages for later (be that organized person you pretend to be)

### 📝 **Notes** - Your brain's external hard drive

- Create notes faster than you can forget why you needed them
- Search through that digital mess you call "organized notes"
- Actually find that brilliant idea you wrote down 3 months ago

### 👥 **Contacts** - Your personal network, digitized

- Find anyone in your contacts without scrolling forever
- Get phone numbers instantly (no more "hey, what's your number again?")
- Actually use that contact database you've been building for years

### 📧 **Mail** - Email like a pro (or at least pretend to)

- Send emails with attachments, CC, BCC - the whole professional shebang
- Search through your email chaos with surgical precision
- Schedule emails for later (because 3 AM ideas shouldn't be sent at 3 AM)
- Check unread counts (prepare for existential dread)

### ⏰ **Reminders** - For humans with human memory

- Create reminders with due dates (finally remember to do things)
- Search through your reminder graveyard
- List everything you've been putting off
- Open specific reminders (face your procrastination)

### 📅 **Calendar** - Time management for the chronically late

- Create events faster than you can double-book yourself
- Search for that meeting you're definitely forgetting about
- List upcoming events (spoiler: you're probably late to something)
- Open calendar events directly (skip the app hunting)

### 🗺️ **Maps** - For people who still get lost with GPS

- Search locations (find that coffee shop with the weird name)
- Save favorites (bookmark your life's important spots)
- Get directions (finally stop asking Siri while driving)
- Create guides (be that friend who plans everything)
- Drop pins like you're claiming territory

## 🎭 The Magic of Chaining Commands

Here's where it gets spicy. You can literally say:

_"Read my conference notes, find contacts for the people I met, and send them a thank you message"_

And it just... **works**. Like actual magic, but with more code.

## 🚀 Installation (The Easy Way)

### Option 1: Smithery (For the Sophisticated)

```bash
npx -y install-mcp apple-mcp --client claude
```

For Cursor users (we see you):

```bash
npx -y install-mcp apple-mcp --client cursor
```

### Option 2: Manual Setup (For the Brave)

<details>
<summary>Click if you're feeling adventurous</summary>

First, get bun (if you don't have it already):

```bash
brew install oven-sh/bun/bun
```

Then add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "apple-mcp": {
      "command": "bunx",
      "args": ["--no-cache", "apple-mcp@latest"]
    }
  }
}
```

</details>

## 🎬 See It In Action

Here's a step-by-step video walkthrough: https://x.com/DhravyaShah/status/1892694077679763671

(Yes, it's actually as cool as it sounds)

## 🎯 Example Commands That'll Blow Your Mind

```
"Send a message to mom saying I'll be late for dinner"
```

```
"Find all my AI research notes and email them to sarah@company.com"
```

```
"Create a reminder to call the dentist tomorrow at 2pm"
```

```
"Show me my calendar for next week and create an event for coffee with Alex on Friday"
```

```
"Find the nearest pizza place and save it to my favorites"
```

## 🛠️ Local Development (For the Tinkerers)

```bash
git clone https://github.com/dhravya/apple-mcp.git
cd apple-mcp
bun install
bun run index.ts
```

Now go forth and automate your digital life! 🚀

---

## 🌐 Network Mode (MCP over HTTP + read-only REST API)

By default the server talks **stdio** (for Claude Desktop). It can also run as a
network service so other machines/agents on your LAN can use it — over **MCP
Streamable HTTP** and a **read-only REST API**.

> 📖 **Full usage guide with per-endpoint examples, Hermes/MCP client setup, launchd,
> permissions, and troubleshooting: [`docs/USAGE.md`](docs/USAGE.md).** The summary below
> is the short version.

### Run it

```bash
# dev
MCP_AUTH_TOKEN=full-secret MCP_READONLY_TOKEN=read-secret bun run http

# or with an env file (see .env.example)
```

### Configuration (env vars)

| Var | Default | Purpose |
|-----|---------|---------|
| `MCP_TRANSPORT` | `stdio` | Set to `http` for network mode |
| `HOST` | `0.0.0.0` | Bind address (http mode) |
| `PORT` | `3737` | Listen port |
| `MCP_AUTH_TOKEN` | — | **Full-access** bearer token (all operations, incl. sending) |
| `MCP_READONLY_TOKEN` | — | **Read-only** bearer token — give this one to Hermes |

In http mode at least one token must be set or the server refuses to start
(fail-closed). Tokens must be distinct.

### Authorization scopes

Every request needs `Authorization: Bearer <token>`. The token decides the scope:

- **Full token** → all tools/operations.
- **Read-only token** → everything **except** `mail:send`, `messages:send`, and
  `messages:schedule`. It can still read mail/messages and create
  notes/reminders/calendar events. Blocked calls return a tool error, not a crash.

### Endpoints

- `POST /mcp` — MCP Streamable HTTP. Point Hermes here:
  `http://<host>:3737/mcp` with `Authorization: Bearer <MCP_READONLY_TOKEN>`.
- `GET /healthz` — liveness, no auth.
- `GET /api/v1/contacts?name=&limit=&offset=`
- `GET /api/v1/notes?folder=&from=&to=&q=&limit=&offset=`
- `GET /api/v1/mail?account=&unread=&q=&limit=&offset=`, `/api/v1/mail/accounts`, `/api/v1/mail/mailboxes?account=`
- `GET /api/v1/calendar/events?q=&from=&to=&limit=&offset=`
- `GET /api/v1/reminders?list=&listId=&q=&limit=&offset=` (+ date filters `created[gte]=`/`due[lte]=` etc.)

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

---

_Made with ❤️ by supermemory (and honestly, claude code)_
