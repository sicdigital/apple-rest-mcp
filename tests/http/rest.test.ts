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
