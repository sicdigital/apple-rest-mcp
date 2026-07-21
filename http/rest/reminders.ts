import { Hono } from "hono";
import reminders from "../../utils/reminders.js";
import { requireFullScope } from "../auth.js";
import { readPageParams, paginate, envelope } from "./pagination.js";
import { parseAppleScriptDate, appleScriptDateToISO } from "./dates.js";

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

		type Row = {
			name?: string;
			id?: string;
			body?: string;
			completed?: boolean;
			dueDate?: string | null;
			creationDate?: string | null;
			listName?: string;
		};
		let rows: Row[];
		if (q) rows = await reminders.searchReminders(q);
		else if (listId) rows = await reminders.getRemindersFromListById(listId);
		else if (list) rows = await reminders.getAllReminders(list);
		else rows = await reminders.getAllReminders();

		const filtered = rows.filter(
			(rem) =>
				matchesField(rem.dueDate, dueConstraints) &&
				matchesField(rem.creationDate, createdConstraints),
		);

		// Normalize AppleScript-localized dates to ISO 8601 in the response.
		const page = paginate(filtered, limit, offset).map((rem) => ({
			...rem,
			dueDate: appleScriptDateToISO(rem.dueDate),
			creationDate: appleScriptDateToISO(rem.creationDate),
		}));

		return c.json(envelope(page, limit, offset));
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
