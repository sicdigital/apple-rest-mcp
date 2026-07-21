import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { readHttpConfig, type HttpConfig } from "./env.js";
import { bearerAuth } from "./auth.js";
import { handleMcp } from "./mcp.js";
import { contactsRoutes } from "./rest/contacts.js";
import { notesRoutes } from "./rest/notes.js";
import { mailRoutes } from "./rest/mail.js";
import { calendarRoutes } from "./rest/calendar.js";
import { remindersRoutes } from "./rest/reminders.js";

export function buildApp(cfg: HttpConfig = readHttpConfig(process.env)): Hono {
	const app = new Hono();

	// CORS first so preflight/health work without a token.
	app.use(
		"*",
		cors({
			origin: "*",
			allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
			allowHeaders: [
				"Content-Type",
				"Authorization",
				"mcp-session-id",
				"Last-Event-ID",
				"mcp-protocol-version",
			],
			exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
		}),
	);

	// Liveness — registered before auth so it stays unauthenticated.
	app.get("/healthz", (c) => c.json({ ok: true }));

	// Everything below requires a valid token.
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
	console.error(
		`apple-mcp HTTP server listening on http://${cfg.host}:${cfg.port}`,
	);
	console.error(`  MCP:  POST http://${cfg.host}:${cfg.port}/mcp`);
	console.error(`  REST: GET  http://${cfg.host}:${cfg.port}/api/v1/...`);
}
