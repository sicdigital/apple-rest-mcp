# Network-Accessible apple-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing stdio-only apple-mcp server over the LAN as MCP-over-HTTP (Streamable HTTP) plus a read-only REST API, with bearer-token scopes so a read-only token cannot send mail or messages, kept alive by a macOS LaunchAgent.

**Architecture:** Extract the MCP server construction out of `index.ts` into an importable `mcp/server.ts` factory (`createMcpServer({ allowMessaging })`) so both a stdio path and a new HTTP path can reuse identical tool wiring. `index.ts` becomes a thin transport switch driven by `MCP_TRANSPORT`. The HTTP path is a Hono app (`http/`) mounting scoped bearer auth, the MCP Streamable-HTTP transport at `/mcp`, and read-only REST endpoints at `/api/v1/*`. Write-blocking is enforced at the tool-operation level inside the MCP call handler.

**Tech Stack:** Bun, TypeScript (ESM, `.js` import specifiers), `@modelcontextprotocol/sdk` (upgraded to `1.29.0`), Hono + `@hono/node-server`, Zod, `bun:test`.

---

## Spec

`docs/superpowers/specs/2026-07-20-network-accessible-apple-mcp-design.md`

## File Structure

**New files:**
- `mcp/server.ts` — `loadModule`, arg type guards, the tool-call switch, and `createMcpServer({ allowMessaging })`. Moved out of `index.ts`.
- `http/env.ts` — parse/validate env config (`readHttpConfig()`), fail-closed token check.
- `http/auth.ts` — Hono bearer-token middleware; resolves token → scope; constant-time compare.
- `http/mcp.ts` — mounts `StreamableHTTPServerTransport` at `/mcp`, per-session, scope-aware.
- `http/rest/pagination.ts` — `paginate()` + `envelope()` helpers.
- `http/rest/contacts.ts`, `notes.ts`, `mail.ts`, `calendar.ts`, `reminders.ts` — read-only route factories.
- `http/server.ts` — builds the Hono app, wires middleware/routes, starts `@hono/node-server`.
- `deploy/com.sicdigital.apple-mcp.plist.template` — LaunchAgent template.
- `deploy/install-launchagent.sh` — renders + installs the LaunchAgent.
- `.env.example` — documents all env vars.
- Tests: `tests/http/auth.test.ts`, `tests/http/scope.test.ts`, `tests/http/rest.test.ts`, `tests/http/env.test.ts`, `tests/http/mcp.test.ts`.

**Modified files:**
- `index.ts` — remove the moved logic; add the `MCP_TRANSPORT` switch + `startStdio()`.
- `package.json` — SDK bump; `http`/`start:http` scripts; wire `test:http`.
- `README.md` — network usage + permissions section.

---

## Task 1: Upgrade the MCP SDK to a version with Streamable HTTP

**Files:**
- Modify: `package.json` (dependency version)

- [ ] **Step 1: Confirm current SDK lacks the transport**

Run: `ls node_modules/@modelcontextprotocol/sdk/dist/esm/server/ | grep -i http`
Expected: no `streamableHttp.js` (only `sse.js`, `stdio.js`) — confirms the upgrade is needed.

- [ ] **Step 2: Upgrade the SDK**

Run: `bun add @modelcontextprotocol/sdk@1.29.0`
Expected: `package.json` shows `"@modelcontextprotocol/sdk": "1.29.0"` (or `^1.29.0`), lockfile updated.

- [ ] **Step 3: Verify the transport now exists**

Run: `ls node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js && grep -o "class StreamableHTTPServerTransport" node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js`
Expected: the file path prints and `class StreamableHTTPServerTransport` matches.

- [ ] **Step 4: Verify stdio still builds under the new SDK**

Run: `timeout 6 bun run index.ts 2>&1 | grep -E "Starting apple-mcp server|Server connected successfully" ; echo "exit ok"`
Expected: sees `Starting apple-mcp server...` and eventually `Server connected successfully!` (regression check: existing stdio path unbroken).

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lockb
git commit -m "build: upgrade @modelcontextprotocol/sdk to 1.29.0 for Streamable HTTP transport"
```

---

## Task 2: Extract `createMcpServer` factory (refactor, no behavior change)

This moves the MCP server wiring out of `index.ts` so the HTTP path can import it without triggering stdio startup. It is a **mechanical move** — do not change tool logic.

**Files:**
- Create: `mcp/server.ts`
- Modify: `index.ts`

- [ ] **Step 1: Create `mcp/server.ts` with the factory shell and move the shared logic into it**

Move the following out of `index.ts` into `mcp/server.ts`, keeping the code identical except where noted:
1. The module-cache variables (`contacts`, `notes`, `message`, `mail`, `reminders`, `calendar`, `maps`), the `ModuleMap` type, and the `loadModule<T>()` function.
2. The safe-mode plumbing that `loadModule` reads (`safeModeFallback`). Keep `let safeModeFallback = false;` in `mcp/server.ts` and export a setter `export function setSafeMode(v: boolean) { safeModeFallback = v; }` (index.ts's timeout handler will call it).
3. All arg type-guard functions (`isContactsArgs`, `isNotesArgs`, `isMessagesArgs`, `isMailArgs`, `isRemindersArgs`, `isCalendarArgs`, `isMapsArgs` — every `is*Args` helper at the bottom of `index.ts`).
4. The entire `CallToolRequestSchema` handler body — extract it into `async function handleToolCall(request, allowMessaging: boolean): Promise<CallToolResult>` (the code currently inside `server.setRequestHandler(CallToolRequestSchema, async (request) => { ... })`).

Then add the factory at the top of the file:

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import tools from "../tools.js";

export interface McpServerOptions {
	/** When false, mail:send / messages:send / messages:schedule are rejected. */
	allowMessaging?: boolean;
}

export function createMcpServer(options: McpServerOptions = {}): Server {
	const allowMessaging = options.allowMessaging ?? true;

	const server = new Server(
		{ name: "Apple MCP tools", version: "1.0.0" },
		{ capabilities: { tools: {} } },
	);

	server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

	server.setRequestHandler(CallToolRequestSchema, async (request) =>
		handleToolCall(request, allowMessaging),
	);

	return server;
}
```

Leave `attemptEagerLoading()` and the 5s safe-mode timeout in `index.ts` (they are startup concerns, not server-construction). They mutate the module cache via the moved `loadModule`, so also export the cache-reset helper the timeout needs:

```ts
export function resetModuleCache(): void {
	contacts = null; notes = null; message = null;
	mail = null; reminders = null; calendar = null; maps = null;
}
```

`import` the moved symbols back into `index.ts`: `import { createMcpServer, loadModule, resetModuleCache, setSafeMode } from "./mcp/server.js";` (index.ts's `attemptEagerLoading` still assigns to the cache — change it to call `loadModule("contacts")` etc. instead of assigning module-locals, since the cache now lives in `mcp/server.ts`).

- [ ] **Step 2: Add the write-block guard at the top of `handleToolCall`**

Immediately after destructuring `const { name, arguments: args } = request.params;` and the `if (!args)` check, insert:

```ts
const op = (args as { operation?: string }).operation;
const isBlockedWrite =
	(name === "mail" && op === "send") ||
	(name === "messages" && (op === "send" || op === "schedule"));
if (!allowMessaging && isBlockedWrite) {
	return {
		content: [
			{
				type: "text",
				text: `Operation ${name}:${op} is not permitted for this token (read-only).`,
			},
		],
		isError: true,
	};
}
```

- [ ] **Step 3: Type-check the move**

Run: `bunx tsc --noEmit`
Expected: no errors. (If `CallToolResult` import path differs, confirm with `grep -rn "CallToolResult" node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts | head -1`.)

- [ ] **Step 4: Verify stdio still runs after the refactor**

Run: `timeout 6 bun run index.ts 2>&1 | grep -E "Starting apple-mcp server|Server connected successfully"`
Expected: both log lines appear — refactor preserved stdio behavior.

- [ ] **Step 5: Commit**

```bash
git add mcp/server.ts index.ts
git commit -m "refactor: extract createMcpServer factory with allowMessaging guard"
```

---

## Task 3: Convert `index.ts` into a transport switch

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: Wrap the existing stdio startup in `startStdio()`**

Take the current transport IIFE (the `(async () => { ... StdioServerTransport ... server.connect(transport) ... })()` block inside the old `initServer`) and turn it into a named function that builds a full-access server:

```ts
async function startStdio(): Promise<void> {
	const server = createMcpServer({ allowMessaging: true });
	const transport = new StdioServerTransport();

	// Ensure stdout is only used for JSON messages
	const originalStdoutWrite = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((chunk: any, encoding?: any, callback?: any) => {
		if (typeof chunk === "string" && !chunk.startsWith("{")) return true;
		return originalStdoutWrite(chunk, encoding, callback);
	}) as typeof process.stdout.write;

	await server.connect(transport);
	console.error("Server connected successfully (stdio)!");
}
```

Keep the existing safe-mode `attemptEagerLoading()` + 5s timeout, but their success/fallback branches should now call a single `start()` dispatcher instead of the old `initServer()`.

- [ ] **Step 2: Add the transport dispatcher at the end of `index.ts`**

```ts
async function start(): Promise<void> {
	if (loadingTimeout) { clearTimeout(loadingTimeout); loadingTimeout = null; }
	const transport = (process.env.MCP_TRANSPORT ?? "stdio").toLowerCase();
	if (transport === "http") {
		const { startHttpServer } = await import("./http/server.js");
		await startHttpServer();
	} else {
		await startStdio();
	}
}
```

Replace every remaining call to the old `initServer()` (in the eager-load success path and the timeout fallback path) with `start()`. Ensure `start()` is invoked exactly once.

- [ ] **Step 3: Type-check**

Run: `bunx tsc --noEmit`
Expected: no errors. (`./http/server.js` will not exist yet — the dynamic `import()` is not resolved at type-check time, so this passes; it is only reached at runtime in http mode, added in Task 8.)

- [ ] **Step 4: Verify default (stdio) still works and http mode fails cleanly (module not built yet)**

Run: `timeout 6 bun run index.ts 2>&1 | grep -E "Server connected successfully \(stdio\)"`
Expected: prints the stdio success line.

- [ ] **Step 5: Commit**

```bash
git add index.ts
git commit -m "feat: MCP_TRANSPORT switch (stdio default) with startStdio path"
```

---

## Task 4: Env config with fail-closed token validation

**Files:**
- Create: `http/env.ts`
- Test: `tests/http/env.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/http/env.test.ts
import { describe, it, expect } from "bun:test";
import { readHttpConfig } from "../../http/env.js";

describe("readHttpConfig", () => {
	it("throws when no token is set", () => {
		expect(() => readHttpConfig({})).toThrow(/token/i);
	});

	it("throws when full and readonly tokens are identical", () => {
		expect(() =>
			readHttpConfig({ MCP_AUTH_TOKEN: "same", MCP_READONLY_TOKEN: "same" }),
		).toThrow(/distinct/i);
	});

	it("defaults host/port and accepts a readonly-only token", () => {
		const cfg = readHttpConfig({ MCP_READONLY_TOKEN: "r" });
		expect(cfg.host).toBe("0.0.0.0");
		expect(cfg.port).toBe(3737);
		expect(cfg.fullToken).toBeUndefined();
		expect(cfg.readonlyToken).toBe("r");
	});

	it("parses PORT/HOST and both tokens", () => {
		const cfg = readHttpConfig({
			MCP_AUTH_TOKEN: "f", MCP_READONLY_TOKEN: "r",
			HOST: "127.0.0.1", PORT: "9494",
		});
		expect(cfg.host).toBe("127.0.0.1");
		expect(cfg.port).toBe(9494);
		expect(cfg.fullToken).toBe("f");
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test tests/http/env.test.ts`
Expected: FAIL — cannot find module `../../http/env.js`.

- [ ] **Step 3: Implement `http/env.ts`**

```ts
export interface HttpConfig {
	host: string;
	port: number;
	fullToken?: string;
	readonlyToken?: string;
}

export function readHttpConfig(env: Record<string, string | undefined>): HttpConfig {
	const fullToken = env.MCP_AUTH_TOKEN?.trim() || undefined;
	const readonlyToken = env.MCP_READONLY_TOKEN?.trim() || undefined;

	if (!fullToken && !readonlyToken) {
		throw new Error(
			"HTTP mode requires MCP_AUTH_TOKEN and/or MCP_READONLY_TOKEN to be set (fail-closed).",
		);
	}
	if (fullToken && readonlyToken && fullToken === readonlyToken) {
		throw new Error("MCP_AUTH_TOKEN and MCP_READONLY_TOKEN must be distinct.");
	}

	const port = env.PORT ? Number.parseInt(env.PORT, 10) : 3737;
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid PORT: ${env.PORT}`);
	}

	return { host: env.HOST?.trim() || "0.0.0.0", port, fullToken, readonlyToken };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test tests/http/env.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add http/env.ts tests/http/env.test.ts
git commit -m "feat(http): env config with fail-closed token validation"
```

---

## Task 5: Scoped bearer-token auth middleware

**Files:**
- Create: `http/auth.ts`
- Test: `tests/http/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/http/auth.test.ts
import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { bearerAuth, getScope } from "../../http/auth.js";

function app() {
	const a = new Hono();
	a.use("*", bearerAuth({ fullToken: "f", readonlyToken: "r" }));
	a.get("/x", (c) => c.json({ scope: getScope(c) }));
	return a;
}

describe("bearerAuth", () => {
	it("401 when no header", async () => {
		const res = await app().request("/x");
		expect(res.status).toBe(401);
	});
	it("401 on unknown token", async () => {
		const res = await app().request("/x", { headers: { Authorization: "Bearer nope" } });
		expect(res.status).toBe(401);
	});
	it("resolves full scope", async () => {
		const res = await app().request("/x", { headers: { Authorization: "Bearer f" } });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ scope: "full" });
	});
	it("resolves read scope", async () => {
		const res = await app().request("/x", { headers: { Authorization: "Bearer r" } });
		expect(await res.json()).toEqual({ scope: "read" });
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test tests/http/auth.test.ts`
Expected: FAIL — cannot find module `../../http/auth.js`.

- [ ] **Step 3: Implement `http/auth.ts`**

```ts
import { timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";

export type Scope = "full" | "read";

interface AuthOptions {
	fullToken?: string;
	readonlyToken?: string;
}

function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}

export function bearerAuth(opts: AuthOptions): MiddlewareHandler {
	return async (c, next) => {
		const header = c.req.header("Authorization") ?? "";
		const token = header.startsWith("Bearer ") ? header.slice(7) : "";
		let scope: Scope | undefined;
		if (opts.fullToken && safeEqual(token, opts.fullToken)) scope = "full";
		else if (opts.readonlyToken && safeEqual(token, opts.readonlyToken)) scope = "read";

		if (!scope) return c.json({ error: "unauthorized" }, 401);
		c.set("scope", scope);
		await next();
	};
}

export function getScope(c: Context): Scope {
	return c.get("scope") as Scope;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test tests/http/auth.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add http/auth.ts tests/http/auth.test.ts
git commit -m "feat(http): scoped bearer-token auth middleware"
```

---

## Task 6: REST pagination/envelope helpers + one read route (contacts)

**Files:**
- Create: `http/rest/pagination.ts`, `http/rest/contacts.ts`
- Test: `tests/http/rest.test.ts`

- [ ] **Step 1: Write the failing test (helpers + contacts route with mocked util)**

```ts
// tests/http/rest.test.ts
import { describe, it, expect, mock } from "bun:test";
import { Hono } from "hono";
import { paginate, envelope } from "../../http/rest/pagination.js";

describe("pagination helpers", () => {
	it("paginate slices with limit/offset", () => {
		expect(paginate([1, 2, 3, 4, 5], 2, 1)).toEqual([2, 3]);
	});
	it("envelope wraps data with counts", () => {
		expect(envelope([1, 2], 10, 0)).toEqual({
			data: [1, 2],
			pagination: { limit: 10, offset: 0, count: 2 },
		});
	});
});

describe("contacts route", () => {
	it("returns enveloped contacts from the module", async () => {
		mock.module("../../utils/contacts.js", () => ({
			default: {
				getAllNumbers: async () => ({ Alice: ["111"], Bob: ["222"] }),
				findNumber: async (n: string) => (n === "Alice" ? ["111"] : []),
			},
		}));
		const { contactsRoutes } = await import("../../http/rest/contacts.js");
		const app = new Hono();
		app.route("/api/v1/contacts", contactsRoutes());

		const all = await app.request("/api/v1/contacts");
		expect(all.status).toBe(200);
		const body = await all.json();
		expect(body.data).toContainEqual({ name: "Alice", phones: ["111"] });
		expect(body.pagination.count).toBe(2);

		const one = await app.request("/api/v1/contacts?name=Alice");
		expect((await one.json()).data).toEqual([{ name: "Alice", phones: ["111"] }]);
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test tests/http/rest.test.ts`
Expected: FAIL — cannot find `../../http/rest/pagination.js`.

- [ ] **Step 3: Implement the helpers**

```ts
// http/rest/pagination.ts
export function readPageParams(url: URL): { limit: number; offset: number } {
	const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100), 1), 1000);
	const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
	return { limit, offset };
}

export function paginate<T>(items: T[], limit: number, offset: number): T[] {
	return items.slice(offset, offset + limit);
}

export function envelope<T>(data: T[], limit: number, offset: number) {
	return { data, pagination: { limit, offset, count: data.length } };
}
```

- [ ] **Step 4: Implement the contacts route**

```ts
// http/rest/contacts.ts
import { Hono } from "hono";
import contacts from "../../utils/contacts.js";
import { readPageParams, paginate, envelope } from "./pagination.js";

export function contactsRoutes(): Hono {
	const r = new Hono();
	r.get("/", async (c) => {
		const url = new URL(c.req.url);
		const { limit, offset } = readPageParams(url);
		const name = url.searchParams.get("name");

		let rows: { name: string; phones: string[] }[];
		if (name) {
			const phones = await contacts.findNumber(name);
			rows = phones.length ? [{ name, phones }] : [];
		} else {
			const all = await contacts.getAllNumbers();
			rows = Object.entries(all).map(([n, phones]) => ({ name: n, phones }));
		}
		return c.json(envelope(paginate(rows, limit, offset), limit, offset));
	});
	return r;
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `bun test tests/http/rest.test.ts`
Expected: PASS (helpers + contacts).

- [ ] **Step 6: Commit**

```bash
git add http/rest/pagination.ts http/rest/contacts.ts tests/http/rest.test.ts
git commit -m "feat(http): REST pagination helpers + contacts read route"
```

---

## Task 7: Remaining REST read routes (notes, mail, calendar, reminders)

Reuse the same pattern as `contacts.ts`. Each returns a `Hono` sub-app via a `*Routes()` factory. Apply `q` filtering and pagination in-process where the util returns a full set.

**Files:**
- Create: `http/rest/notes.ts`, `http/rest/mail.ts`, `http/rest/calendar.ts`, `http/rest/reminders.ts`
- Test: append cases to `tests/http/rest.test.ts`

- [ ] **Step 1: Write failing tests (one per route, mocked utils)**

```ts
// append to tests/http/rest.test.ts
import { describe as d2, it as i2, expect as e2, mock as m2 } from "bun:test";
import { Hono as H2 } from "hono";

d2("notes route", () => {
	i2("lists notes and filters by q", async () => {
		m2.module("../../utils/notes.js", () => ({
			default: {
				getAllNotes: async () => [
					{ name: "Groceries", content: "milk" },
					{ name: "Ideas", content: "app" },
				],
				getNotesFromFolder: async () => [],
				getNotesByDateRange: async () => [],
				findNote: async () => [],
			},
		}));
		const { notesRoutes } = await import("../../http/rest/notes.js");
		const app = new H2().route("/n", notesRoutes());
		const res = await app.request("/n?q=idea");
		const body = await res.json();
		e2(body.data).toEqual([{ name: "Ideas", content: "app" }]);
	});
});

d2("reminders route", () => {
	i2("lists reminders", async () => {
		m2.module("../../utils/reminders.js", () => ({
			default: {
				getAllReminders: async () => [{ name: "Call dentist", completed: false }],
				getRemindersFromListById: async () => [],
				searchReminders: async () => [],
			},
		}));
		const { remindersRoutes } = await import("../../http/rest/reminders.js");
		const app = new H2().route("/r", remindersRoutes());
		const res = await app.request("/r");
		e2((await res.json()).pagination.count).toBe(1);
	});
});

d2("calendar route", () => {
	i2("lists events", async () => {
		m2.module("../../utils/calendar.js", () => ({
			default: {
				listEvents: async () => [{ id: "1", title: "Standup" }],
				searchEvents: async () => [],
			},
		}));
		const { calendarRoutes } = await import("../../http/rest/calendar.js");
		const app = new H2().route("/c", calendarRoutes());
		const res = await app.request("/c/events");
		e2((await res.json()).data[0].title).toBe("Standup");
	});
});

d2("mail route", () => {
	i2("lists latest mail", async () => {
		m2.module("../../utils/mail.js", () => ({
			default: {
				getLatestMails: async () => [{ subject: "Hi", sender: "a@b.c" }],
				getUnreadMails: async () => [],
				searchMails: async () => [],
				getMailboxes: async () => ["INBOX"],
				getAccounts: async () => ["iCloud"],
				getMailboxesForAccount: async () => ["INBOX"],
			},
		}));
		const { mailRoutes } = await import("../../http/rest/mail.js");
		const app = new H2().route("/m", mailRoutes());
		e2((await (await app.request("/m")).json()).data[0].subject).toBe("Hi");
		e2((await (await app.request("/m/accounts")).json()).data).toEqual(["iCloud"]);
	});
});
```

> **Before implementing:** confirm the exact calendar function names — run
> `grep -n "^const calendar\|listEvents\|searchEvents\|getEvents\|async function" utils/calendar.ts | head`.
> Use the real names in both the mock and the route (the mock above assumes
> `listEvents` / `searchEvents`; adjust both sides to match the source).

- [ ] **Step 2: Run to see failures**

Run: `bun test tests/http/rest.test.ts`
Expected: FAIL — missing route modules.

- [ ] **Step 3: Implement `http/rest/notes.ts`**

```ts
import { Hono } from "hono";
import notes from "../../utils/notes.js";
import { readPageParams, paginate, envelope } from "./pagination.js";

export function notesRoutes(): Hono {
	const r = new Hono();
	r.get("/", async (c) => {
		const url = new URL(c.req.url);
		const { limit, offset } = readPageParams(url);
		const folder = url.searchParams.get("folder");
		const from = url.searchParams.get("from");
		const to = url.searchParams.get("to");
		const q = url.searchParams.get("q")?.toLowerCase();

		let rows: { name: string; content: string }[];
		if (from && to) rows = await notes.getNotesByDateRange(from, to);
		else if (folder) rows = await notes.getNotesFromFolder(folder);
		else rows = await notes.getAllNotes();

		if (q) rows = rows.filter(
			(n) => n.name.toLowerCase().includes(q) || n.content.toLowerCase().includes(q),
		);
		return c.json(envelope(paginate(rows, limit, offset), limit, offset));
	});
	return r;
}
```

- [ ] **Step 4: Implement `http/rest/reminders.ts`**

```ts
import { Hono } from "hono";
import reminders from "../../utils/reminders.js";
import { readPageParams, paginate, envelope } from "./pagination.js";

export function remindersRoutes(): Hono {
	const r = new Hono();
	r.get("/", async (c) => {
		const url = new URL(c.req.url);
		const { limit, offset } = readPageParams(url);
		const listId = url.searchParams.get("listId");
		const q = url.searchParams.get("q");

		let rows: unknown[];
		if (q) rows = await reminders.searchReminders(q);
		else if (listId) rows = await reminders.getRemindersFromListById(listId);
		else rows = await reminders.getAllReminders();

		return c.json(envelope(paginate(rows, limit, offset), limit, offset));
	});
	return r;
}
```

- [ ] **Step 5: Implement `http/rest/calendar.ts`** (adjust fn names to match `utils/calendar.ts`)

```ts
import { Hono } from "hono";
import calendar from "../../utils/calendar.js";
import { readPageParams, paginate, envelope } from "./pagination.js";

export function calendarRoutes(): Hono {
	const r = new Hono();
	r.get("/events", async (c) => {
		const url = new URL(c.req.url);
		const { limit, offset } = readPageParams(url);
		const q = url.searchParams.get("q");
		const from = url.searchParams.get("from") ?? undefined;
		const to = url.searchParams.get("to") ?? undefined;

		// Use the real exported names from utils/calendar.ts (confirmed in Step 1).
		const rows = q
			? await (calendar as any).searchEvents(q, from, to)
			: await (calendar as any).listEvents(from, to, limit);

		return c.json(envelope(paginate(rows, limit, offset), limit, offset));
	});
	return r;
}
```

- [ ] **Step 6: Implement `http/rest/mail.ts`**

```ts
import { Hono } from "hono";
import mail from "../../utils/mail.js";
import { readPageParams, paginate, envelope } from "./pagination.js";

export function mailRoutes(): Hono {
	const r = new Hono();

	r.get("/", async (c) => {
		const url = new URL(c.req.url);
		const { limit, offset } = readPageParams(url);
		const account = url.searchParams.get("account") ?? undefined;
		const mailbox = url.searchParams.get("mailbox") ?? undefined;
		const q = url.searchParams.get("q");
		const unread = url.searchParams.get("unread") === "true";

		let rows: unknown[];
		if (q) rows = await mail.searchMails(q, limit);
		else if (unread) rows = await mail.getUnreadMails(limit, account, mailbox);
		else rows = await mail.getLatestMails(limit, account, mailbox);

		return c.json(envelope(paginate(rows, limit, offset), limit, offset));
	});

	r.get("/accounts", async (c) => {
		const rows = await mail.getAccounts();
		return c.json(envelope(rows, rows.length, 0));
	});

	r.get("/mailboxes", async (c) => {
		const account = new URL(c.req.url).searchParams.get("account");
		const rows = account
			? await mail.getMailboxesForAccount(account)
			: await mail.getMailboxes();
		return c.json(envelope(rows, rows.length, 0));
	});

	return r;
}
```

> **Before implementing:** confirm `mail` function arities — run
> `grep -n "getLatestMails\|getUnreadMails\|searchMails\|getMailboxes\b\|getAccounts\|getMailboxesForAccount" utils/mail.ts`.
> Adjust the argument order above to match the real signatures.

- [ ] **Step 7: Run tests to verify pass**

Run: `bun test tests/http/rest.test.ts`
Expected: PASS (all route cases).

- [ ] **Step 8: Commit**

```bash
git add http/rest tests/http/rest.test.ts
git commit -m "feat(http): notes/mail/calendar/reminders read routes"
```

---

## Task 8: MCP Streamable-HTTP route + Hono server assembly

**Files:**
- Create: `http/mcp.ts`, `http/server.ts`
- Test: `tests/http/mcp.test.ts`, `tests/http/scope.test.ts`

- [ ] **Step 1: Write the failing scope test (guard is transport-independent)**

```ts
// tests/http/scope.test.ts
import { describe, it, expect, mock } from "bun:test";
import { createMcpServer } from "../../mcp/server.js";
import {
	CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Drive the request handler directly through the SDK Server's internal dispatch
// by using an in-memory linked transport pair.
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

async function connect(allowMessaging: boolean) {
	const server = createMcpServer({ allowMessaging });
	const client = new Client({ name: "t", version: "1" }, { capabilities: {} });
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(a);
	await client.connect(b);
	return client;
}

describe("write-block guard", () => {
	it("read scope rejects messages:send", async () => {
		const client = await connect(false);
		const res: any = await client.callTool({
			name: "messages",
			arguments: { operation: "send", phoneNumber: "1", message: "hi" },
		});
		expect(res.isError).toBe(true);
		expect(JSON.stringify(res.content)).toMatch(/not permitted/i);
	});

	it("read scope rejects mail:send", async () => {
		const client = await connect(false);
		const res: any = await client.callTool({
			name: "mail",
			arguments: { operation: "send", to: "a@b.c", subject: "x", body: "y" },
		});
		expect(res.isError).toBe(true);
	});
});
```

- [ ] **Step 2: Run it to see it fail/pass**

Run: `bun test tests/http/scope.test.ts`
Expected: PASS if Task 2's guard is correct (this test validates the guard added in Task 2). If FAIL, fix the guard in `mcp/server.ts`. (Confirm `InMemoryTransport` path: `ls node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js`.)

- [ ] **Step 3: Implement `http/mcp.ts`**

```ts
import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "../mcp/server.js";
import { getScope } from "./auth.js";

// One transport per MCP session id.
const sessions = new Map<string, StreamableHTTPServerTransport>();

export async function handleMcp(c: Context): Promise<Response> {
	const scope = getScope(c);
	const sessionId = c.req.header("mcp-session-id");
	const nodeReq = (c.req.raw as any);

	let transport = sessionId ? sessions.get(sessionId) : undefined;

	if (!transport) {
		transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: () => randomUUID(),
			onsessioninitialized: (id) => sessions.set(id, transport!),
		});
		transport.onclose = () => {
			if (transport!.sessionId) sessions.delete(transport!.sessionId);
		};
		const server = createMcpServer({ allowMessaging: scope === "full" });
		await server.connect(transport);
	}

	// Bridge the Web Request/Response to the transport (Node req/res shim).
	return await transport.handleHonoRequest(c);
}
```

> **Adapter note:** the SDK's `StreamableHTTPServerTransport.handleRequest` expects
> Node `IncomingMessage`/`ServerResponse`, but Hono/Bun gives a Web `Request`. Two
> supported ways to bridge — pick one and implement `handleMcp` accordingly:
> 1. **Run the HTTP server on Node's `http` module** via `@hono/node-server` (already a
>    dep). `@hono/node-server` exposes the underlying Node `req`/`res` on
>    `c.env.incoming` / `c.env.outgoing` when served through it. Call
>    `await transport.handleRequest(c.env.incoming, c.env.outgoing, await c.req.json())`
>    and return `RESPONSE_ALREADY_SENT` from `@hono/node-server`.
> 2. Use `@modelcontextprotocol/sdk` fetch-native transport if present in 1.29
>    (`grep -rl "fetch" node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js`).
>
> Replace the placeholder `transport.handleHonoRequest(c)` with the chosen bridge.
> Because `@hono/node-server` is the chosen server (Step 4), implement option 1:
> ```ts
> import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
> const body = c.req.method === "POST" ? await c.req.json().catch(() => undefined) : undefined;
> await transport.handleRequest(c.env.incoming, c.env.outgoing, body);
> return RESPONSE_ALREADY_SENT as unknown as Response;
> ```

- [ ] **Step 4: Implement `http/server.ts`**

```ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { readHttpConfig } from "./env.js";
import { bearerAuth } from "./auth.js";
import { handleMcp } from "./mcp.js";
import { contactsRoutes } from "./rest/contacts.js";
import { notesRoutes } from "./rest/notes.js";
import { mailRoutes } from "./rest/mail.js";
import { calendarRoutes } from "./rest/calendar.js";
import { remindersRoutes } from "./rest/reminders.js";

export function buildApp(cfg = readHttpConfig(process.env)): Hono {
	const app = new Hono();

	// Liveness — no auth.
	app.get("/healthz", (c) => c.json({ ok: true }));

	// Everything else requires a valid token.
	app.use("*", bearerAuth({ fullToken: cfg.fullToken, readonlyToken: cfg.readonlyToken }));

	// MCP over Streamable HTTP.
	app.all("/mcp", handleMcp);

	// Read-only REST API.
	app.route("/api/v1/contacts", contactsRoutes());
	app.route("/api/v1/notes", notesRoutes());
	app.route("/api/v1/mail", mailRoutes());
	app.route("/api/v1/calendar", calendarRoutes());
	app.route("/api/v1/reminders", remindersRoutes());

	return app;
}

export async function startHttpServer(): Promise<void> {
	const cfg = readHttpConfig(process.env);
	const app = buildApp(cfg);
	serve({ fetch: app.fetch, hostname: cfg.host, port: cfg.port });
	console.error(`apple-mcp HTTP server listening on http://${cfg.host}:${cfg.port}`);
	console.error(`  MCP:  POST http://${cfg.host}:${cfg.port}/mcp`);
	console.error(`  REST: GET  http://${cfg.host}:${cfg.port}/api/v1/...`);
}
```

- [ ] **Step 5: Write + run the HTTP integration test (auth wiring + healthz)**

```ts
// tests/http/mcp.test.ts
import { describe, it, expect } from "bun:test";
import { buildApp } from "../../http/server.js";

const cfg = { host: "127.0.0.1", port: 3737, fullToken: "f", readonlyToken: "r" };

describe("app wiring", () => {
	it("healthz needs no auth", async () => {
		const res = await buildApp(cfg).request("/healthz");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});
	it("REST requires auth", async () => {
		const res = await buildApp(cfg).request("/api/v1/contacts");
		expect(res.status).toBe(401);
	});
	it("mcp endpoint requires auth", async () => {
		const res = await buildApp(cfg).request("/mcp", { method: "POST" });
		expect(res.status).toBe(401);
	});
});
```

Run: `bun test tests/http/mcp.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Live smoke test — boot HTTP mode and curl it**

Run:
```bash
MCP_TRANSPORT=http PORT=3737 MCP_AUTH_TOKEN=full-xyz MCP_READONLY_TOKEN=read-abc bun run index.ts &
SERVER_PID=$!
sleep 3
echo "--- healthz (no auth) ---"; curl -s http://127.0.0.1:3737/healthz
echo "--- no token (expect 401) ---"; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3737/api/v1/contacts
echo "--- read token contacts ---"; curl -s -H "Authorization: Bearer read-abc" "http://127.0.0.1:3737/api/v1/contacts?limit=3"
kill $SERVER_PID
```
Expected: `{"ok":true}`, then `401`, then a JSON envelope (real contacts if Contacts access is granted, or a graceful error — either proves routing/auth work).

- [ ] **Step 7: Commit**

```bash
git add http/mcp.ts http/server.ts tests/http/mcp.test.ts tests/http/scope.test.ts
git commit -m "feat(http): Streamable-HTTP MCP route + Hono server assembly"
```

---

## Task 9: package.json scripts + `.env.example`

**Files:**
- Modify: `package.json`
- Create: `.env.example`

- [ ] **Step 1: Add scripts**

In `package.json` `"scripts"`, add:
```json
"http": "MCP_TRANSPORT=http bun run index.ts",
"start:http": "MCP_TRANSPORT=http node dist/index.js",
"test:http": "bun test tests/http/*.test.ts"
```

- [ ] **Step 2: Create `.env.example`**

```bash
# Transport: "stdio" (default, for Claude Desktop) or "http" (network)
MCP_TRANSPORT=http

# HTTP bind + port (http mode only)
HOST=0.0.0.0
PORT=3737

# Full-access token: all operations incl. sending mail/messages.
MCP_AUTH_TOKEN=change-me-full

# Read-only token: everything EXCEPT mail:send / messages:send / messages:schedule.
# Give THIS token to Hermes.
MCP_READONLY_TOKEN=change-me-readonly
```

- [ ] **Step 3: Verify http test script**

Run: `bun run test:http`
Expected: all `tests/http/*.test.ts` pass.

- [ ] **Step 4: Commit**

```bash
git add package.json .env.example
git commit -m "chore: http/start scripts and .env.example"
```

---

## Task 10: LaunchAgent for persistence

**Files:**
- Create: `deploy/com.sicdigital.apple-mcp.plist.template`, `deploy/install-launchagent.sh`

- [ ] **Step 1: Create the plist template**

```xml
<!-- deploy/com.sicdigital.apple-mcp.plist.template -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.sicdigital.apple-mcp</string>
	<key>ProgramArguments</key>
	<array>
		<string>__BUN__</string>
		<string>run</string>
		<string>__REPO__/index.ts</string>
	</array>
	<key>EnvironmentVariables</key>
	<dict>
		<key>MCP_TRANSPORT</key><string>http</string>
		<key>HOST</key><string>0.0.0.0</string>
		<key>PORT</key><string>__PORT__</string>
		<key>MCP_AUTH_TOKEN</key><string>__FULL_TOKEN__</string>
		<key>MCP_READONLY_TOKEN</key><string>__READONLY_TOKEN__</string>
	</dict>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>StandardOutPath</key><string>__HOME__/Library/Logs/apple-mcp.out.log</string>
	<key>StandardErrorPath</key><string>__HOME__/Library/Logs/apple-mcp.err.log</string>
	<key>WorkingDirectory</key><string>__REPO__</string>
</dict>
</plist>
```

- [ ] **Step 2: Create the installer**

```bash
#!/usr/bin/env bash
# deploy/install-launchagent.sh
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
```

- [ ] **Step 3: Make the installer executable + syntax-check**

Run: `chmod +x deploy/install-launchagent.sh && bash -n deploy/install-launchagent.sh && echo OK`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add deploy/
git commit -m "feat(deploy): LaunchAgent template + installer for persistence"
```

> **Manual install (run by the user, not part of automated tests):**
> ```bash
> MCP_AUTH_TOKEN=... MCP_READONLY_TOKEN=... PORT=3737 ./deploy/install-launchagent.sh
> ```
> First run triggers macOS **Automation** permission prompts (Contacts, Messages, Mail,
> Reminders, Calendar). Approve them while logged into the GUI session. Must be a
> LaunchAgent (user session), never a LaunchDaemon.

---

## Task 11: README documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a "Network / HTTP mode" section**

Append a section documenting:
- Env vars (`MCP_TRANSPORT`, `HOST`, `PORT`, `MCP_AUTH_TOKEN`, `MCP_READONLY_TOKEN`) — reference `.env.example`.
- How to run: `bun run http` (dev) and the LaunchAgent installer (persistent).
- Endpoints: `POST /mcp`, `GET /api/v1/{contacts,notes,mail,calendar,reminders}`, `GET /healthz`.
- The scope model: read-only token cannot `mail:send` / `messages:send` / `messages:schedule`; give Hermes `MCP_READONLY_TOKEN`.
- macOS Automation permissions caveat (LaunchAgent + GUI session; first-run prompts).
- Pointing Hermes at `http://<host>:3737/mcp` with `Authorization: Bearer <token>`.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document network HTTP mode, REST API, and token scopes"
```

---

## Task 12: Full verification pass

- [ ] **Step 1: Type-check the whole project**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Run the full HTTP test suite**

Run: `bun run test:http`
Expected: all pass (env, auth, scope, rest, mcp).

- [ ] **Step 3: End-to-end MCP-over-HTTP handshake with a real client**

Run this script (uses the SDK client against the live server):
```bash
MCP_TRANSPORT=http PORT=3737 MCP_AUTH_TOKEN=full-xyz MCP_READONLY_TOKEN=read-abc bun run index.ts &
SERVER_PID=$!
sleep 3
bun run - <<'EOF'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const t = new StreamableHTTPClientTransport(new URL("http://127.0.0.1:3737/mcp"), {
	requestInit: { headers: { Authorization: "Bearer read-abc" } },
});
const c = new Client({ name: "smoke", version: "1" }, { capabilities: {} });
await c.connect(t);
const tools = await c.listTools();
console.log("TOOLS:", tools.tools.map(x => x.name).join(", "));
const res = await c.callTool({ name: "messages", arguments: { operation: "send", phoneNumber: "1", message: "x" } });
console.log("SEND-BLOCKED:", JSON.stringify(res.content));
await c.close();
EOF
kill $SERVER_PID
```
Expected: `TOOLS: contacts, notes, messages, mail, reminders, calendar, maps` and `SEND-BLOCKED` text containing "not permitted" (read token cannot send).

- [ ] **Step 4: Confirm stdio regression path still works**

Run: `timeout 6 bun run index.ts 2>&1 | grep "Server connected successfully (stdio)"`
Expected: the stdio success line prints.

- [ ] **Step 5: Final commit (if any docs/cleanup remain)**

```bash
git add -A
git commit -m "test: full verification of http + stdio transports" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage:** transport switch (T3), createMcpServer + guard (T2), token scopes/auth (T5), fail-closed env (T4), REST read domains contacts/notes/mail/calendar/reminders (T6–T7), MCP Streamable HTTP (T8), LaunchAgent (T10), README + permissions caveat (T11), SDK upgrade the spec's transport depends on (T1). All spec sections map to a task.
- **Known verification points flagged inline (not placeholders):** exact `utils/calendar.ts` and `utils/mail.ts` function names/arities (grep steps in T7), and the Streamable-HTTP↔Hono request bridge (adapter note in T8 Step 3, with the concrete `@hono/node-server` `RESPONSE_ALREADY_SENT` implementation given). These are real integration seams to confirm against installed code, with the resolution specified.
- **Type consistency:** `createMcpServer({ allowMessaging })`, `readHttpConfig` → `{ host, port, fullToken, readonlyToken }`, `bearerAuth`/`getScope` scope `"full"|"read"`, and `*Routes()` factories are used consistently across tasks.
