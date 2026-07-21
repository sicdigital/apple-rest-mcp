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

	it("filters by created/due date ranges (Stripe-style brackets)", async () => {
		mock.module("../../utils/reminders.js", () => ({
			default: {
				getAllReminders: async () => [
					{ name: "June created", creationDate: "Monday, June 29, 2026 at 1:05:51 AM", dueDate: null },
					{ name: "July created", creationDate: "Wednesday, July 15, 2026 at 9:00:00 AM", dueDate: null },
					{ name: "Due July", creationDate: "Friday, May 1, 2026 at 8:00:00 AM", dueDate: "Thursday, July 30, 2026 at 12:00:00 AM" },
				],
				getRemindersFromListById: async () => [],
				searchReminders: async () => [],
			},
		}));
		const { remindersRoutes } = await import("../../http/rest/reminders.js");
		const app = new Hono().route("/r", remindersRoutes());

		// created in June only
		const june = await app.request("/r?created[gte]=2026-06-01&created[lte]=2026-06-30");
		const juneData = (await june.json()).data;
		expect(juneData.map((x: any) => x.name)).toEqual(["June created"]);
		// dates are normalized to ISO 8601 in the response
		expect(juneData[0].creationDate).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);

		// due before Aug -> only the one with a due date in July
		const due = await app.request("/r?due[gte]=2026-07-01&due[lt]=2026-08-01");
		const dueData = (await due.json()).data;
		expect(dueData.map((x: any) => x.name)).toEqual(["Due July"]);

		// bad date -> 400
		const bad = await app.request("/r?created[gte]=notadate");
		expect(bad.status).toBe(400);
	});
});

describe("reminders write route", () => {
	function appWithScope(scope: "full" | "read") {
		const a = new Hono<{ Variables: { scope: string } }>();
		a.use("*", async (c, next) => {
			c.set("scope", scope);
			await next();
		});
		return a;
	}

	it("creates a reminder with the full token (201)", async () => {
		mock.module("../../utils/reminders.js", () => ({
			default: {
				getAllReminders: async () => [],
				getRemindersFromListById: async () => [],
				searchReminders: async () => [],
				createReminder: async (name: string) => ({
					name,
					id: "new-id",
					body: "",
					completed: false,
					dueDate: null,
					listName: "Reminders",
				}),
			},
		}));
		const { remindersRoutes } = await import("../../http/rest/reminders.js");
		const app = appWithScope("full").route("/r", remindersRoutes());
		const res = await app.request("/r", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Buy milk" }),
		});
		expect(res.status).toBe(201);
		expect((await res.json()).data.name).toBe("Buy milk");
	});

	it("rejects the read token with 403", async () => {
		const { remindersRoutes } = await import("../../http/rest/reminders.js");
		const app = appWithScope("read").route("/r", remindersRoutes());
		const res = await app.request("/r", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Buy milk" }),
		});
		expect(res.status).toBe(403);
	});

	it("400s when name is missing", async () => {
		const { remindersRoutes } = await import("../../http/rest/reminders.js");
		const app = appWithScope("full").route("/r", remindersRoutes());
		const res = await app.request("/r", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ listName: "Home" }),
		});
		expect(res.status).toBe(400);
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
					{
						subject: "Hi",
						sender: "a@b.c",
						dateSent: "Monday, June 29, 2026 at 1:05:51 AM",
					},
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
		const mailData = (await (await app.request("/m")).json()).data;
		expect(mailData[0].subject).toBe("Hi");
		expect(mailData[0].dateSent).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
		expect((await (await app.request("/m/accounts")).json()).data).toEqual([
			"iCloud",
		]);
	});
});
