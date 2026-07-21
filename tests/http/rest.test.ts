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

describe("notes route", () => {
	it("lists notes and filters by q", async () => {
		mock.module("../../utils/notes.js", () => ({
			default: {
				getAllNotes: async () => [
					{ name: "Groceries", content: "milk" },
					{ name: "Ideas", content: "app" },
				],
				getNotesFromFolder: async () => ({ success: true, notes: [] }),
				getNotesByDateRange: async () => ({ success: true, notes: [] }),
				findNote: async () => [],
			},
		}));
		const { notesRoutes } = await import("../../http/rest/notes.js");
		const app = new Hono().route("/n", notesRoutes());
		const res = await app.request("/n?q=idea");
		const body = await res.json();
		expect(body.data).toEqual([{ name: "Ideas", content: "app" }]);
	});
});

describe("reminders route", () => {
	it("lists reminders", async () => {
		mock.module("../../utils/reminders.js", () => ({
			default: {
				getAllReminders: async () => [{ name: "Call dentist", completed: false }],
				getRemindersFromListById: async () => [],
				searchReminders: async () => [],
			},
		}));
		const { remindersRoutes } = await import("../../http/rest/reminders.js");
		const app = new Hono().route("/r", remindersRoutes());
		const res = await app.request("/r");
		expect((await res.json()).pagination.count).toBe(1);
	});
});

describe("calendar route", () => {
	it("lists events", async () => {
		mock.module("../../utils/calendar.js", () => ({
			default: {
				getEvents: async () => [{ id: "1", title: "Standup" }],
				searchEvents: async () => [],
			},
		}));
		const { calendarRoutes } = await import("../../http/rest/calendar.js");
		const app = new Hono().route("/c", calendarRoutes());
		const res = await app.request("/c/events");
		expect((await res.json()).data[0].title).toBe("Standup");
	});
});

describe("mail route", () => {
	it("lists latest mail and accounts", async () => {
		mock.module("../../utils/mail.js", () => ({
			default: {
				getLatestMails: async (_account: string) => [
					{ subject: "Hi", sender: "a@b.c" },
				],
				getUnreadMails: async () => [],
				searchMails: async () => [],
				getMailboxes: async () => ["INBOX"],
				getAccounts: async () => ["iCloud"],
				getMailboxesForAccount: async () => ["INBOX"],
			},
		}));
		const { mailRoutes } = await import("../../http/rest/mail.js");
		const app = new Hono().route("/m", mailRoutes());
		expect((await (await app.request("/m")).json()).data[0].subject).toBe("Hi");
		expect((await (await app.request("/m/accounts")).json()).data).toEqual([
			"iCloud",
		]);
	});
});
