import { Hono } from "hono";
import reminders from "../../utils/reminders.js";
import { requireFullScope } from "../auth.js";
import { readPageParams, paginate, envelope } from "./pagination.js";

type Op = "gte" | "gt" | "lte" | "lt";
const OPS: Op[] = ["gte", "gt", "lte", "lt"];

interface Constraint {
	op: Op;
	value: Date;
}

/** Parse Stripe-style `field[op]=isoDate` params into constraints. Throws on bad dates. */
function readConstraints(url: URL, field: string): Constraint[] {
	const out: Constraint[] = [];
	for (const op of OPS) {
		const raw = url.searchParams.get(`${field}[${op}]`);
		if (raw == null) continue;
		const value = new Date(raw);
		if (Number.isNaN(value.getTime())) {
			throw new Error(`Invalid date for ${field}[${op}]: ${raw}`);
		}
		out.push({ op, value });
	}
	return out;
}

/** Parse an AppleScript localized date string ("Thursday, July 30, 2026 at 12:00:00 AM"). */
function parseAppleScriptDate(s: string | null | undefined): Date | null {
	if (!s || s === "missing value") return null;
	const cleaned = s.replace(/^[A-Za-z]+,\s*/, "").replace(/\s+at\s+/, " ");
	const d = new Date(cleaned);
	return Number.isNaN(d.getTime()) ? null : d;
}

function satisfies(value: Date, { op, value: bound }: Constraint): boolean {
	switch (op) {
		case "gte":
			return value.getTime() >= bound.getTime();
		case "gt":
			return value.getTime() > bound.getTime();
		case "lte":
			return value.getTime() <= bound.getTime();
		case "lt":
			return value.getTime() < bound.getTime();
	}
}

/** Keep a reminder only if its field date exists and meets every constraint. */
function matchesField(
	dateStr: string | null | undefined,
	constraints: Constraint[],
): boolean {
	if (constraints.length === 0) return true;
	const d = parseAppleScriptDate(dateStr);
	if (!d) return false; // no date on this reminder -> can't be in the range
	return constraints.every((c) => satisfies(d, c));
}

export function remindersRoutes(): Hono {
	const r = new Hono();
	r.get("/", async (c) => {
		const url = new URL(c.req.url);
		const { limit, offset } = readPageParams(url);
		const list = url.searchParams.get("list");
		const listId = url.searchParams.get("listId");
		const q = url.searchParams.get("q");

		let dueConstraints: Constraint[];
		let createdConstraints: Constraint[];
		try {
			dueConstraints = readConstraints(url, "due");
			createdConstraints = readConstraints(url, "created");
		} catch (e) {
			return c.json({ error: (e as Error).message }, 400);
		}

		let rows: Array<{ dueDate?: string | null; creationDate?: string | null }>;
		if (q) rows = await reminders.searchReminders(q);
		else if (listId) rows = await reminders.getRemindersFromListById(listId);
		else if (list) rows = await reminders.getAllReminders(list);
		else rows = await reminders.getAllReminders();

		const filtered = rows.filter(
			(rem) =>
				matchesField(rem.dueDate, dueConstraints) &&
				matchesField(rem.creationDate, createdConstraints),
		);

		return c.json(envelope(paginate(filtered, limit, offset), limit, offset));
	});

	// Create a reminder (full token only).
	r.post("/", requireFullScope(), async (c) => {
		let body: {
			name?: unknown;
			listName?: unknown;
			notes?: unknown;
			dueDate?: unknown;
		};
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "invalid JSON body" }, 400);
		}
		if (typeof body.name !== "string" || body.name.trim() === "") {
			return c.json({ error: "name is required" }, 400);
		}
		const created = await reminders.createReminder(
			body.name,
			typeof body.listName === "string" ? body.listName : undefined,
			typeof body.notes === "string" ? body.notes : undefined,
			typeof body.dueDate === "string" ? body.dueDate : undefined,
		);
		return c.json({ data: created }, 201);
	});

	return r;
}
