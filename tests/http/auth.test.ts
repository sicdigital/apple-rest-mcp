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
		const res = await app().request("/x", {
			headers: { Authorization: "Bearer nope" },
		});
		expect(res.status).toBe(401);
	});
	it("resolves full scope", async () => {
		const res = await app().request("/x", {
			headers: { Authorization: "Bearer f" },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ scope: "full" });
	});
	it("resolves read scope", async () => {
		const res = await app().request("/x", {
			headers: { Authorization: "Bearer r" },
		});
		expect(await res.json()).toEqual({ scope: "read" });
	});
});
