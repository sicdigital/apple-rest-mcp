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

/**
 * Require a valid bearer token and attach the resolved scope to the context.
 * MCP_AUTH_TOKEN -> "full", MCP_READONLY_TOKEN -> "read".
 */
export function bearerAuth(opts: AuthOptions): MiddlewareHandler {
	return async (c, next) => {
		const header = c.req.header("Authorization") ?? "";
		const token = header.startsWith("Bearer ") ? header.slice(7) : "";

		let scope: Scope | undefined;
		if (opts.fullToken && safeEqual(token, opts.fullToken)) scope = "full";
		else if (opts.readonlyToken && safeEqual(token, opts.readonlyToken))
			scope = "read";

		if (!scope) return c.json({ error: "unauthorized" }, 401);

		c.set("scope", scope);
		await next();
	};
}

export function getScope(c: Context): Scope {
	return c.get("scope") as Scope;
}
