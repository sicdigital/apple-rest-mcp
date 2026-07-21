import { describe, it, expect } from "bun:test";
import { buildApp } from "../../http/server.js";

const cfg = {
	host: "127.0.0.1",
	port: 3737,
	fullToken: "f",
	readonlyToken: "r",
};

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
	it("serves openapi.yaml without auth", async () => {
		const res = await buildApp(cfg).request("/openapi.yaml");
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain("openapi: 3.1.0");
	});
});
