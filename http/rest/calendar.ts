import { Hono } from "hono";
import calendar from "../../utils/calendar.js";
import { requireFullScope } from "../auth.js";
import { readPageParams, paginate, envelope } from "./pagination.js";

export function calendarRoutes(): Hono {
	const r = new Hono();
	r.get("/events", async (c) => {
		const url = new URL(c.req.url);
		const { limit, offset } = readPageParams(url);
		const q = url.searchParams.get("q");
		const from = url.searchParams.get("from") ?? undefined;
		const to = url.searchParams.get("to") ?? undefined;

		const rows = q
			? await calendar.searchEvents(q, limit, from, to)
			: await calendar.getEvents(limit, from, to);

		return c.json(envelope(paginate(rows, limit, offset), limit, offset));
	});

	// Create an event (full token only).
	r.post("/events", requireFullScope(), async (c) => {
		let body: {
			title?: unknown;
			startDate?: unknown;
			endDate?: unknown;
			location?: unknown;
			notes?: unknown;
			isAllDay?: unknown;
			calendarName?: unknown;
		};
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "invalid JSON body" }, 400);
		}
		if (
			typeof body.title !== "string" ||
			typeof body.startDate !== "string" ||
			typeof body.endDate !== "string" ||
			body.title.trim() === ""
		) {
			return c.json(
				{ error: "title, startDate, and endDate are required" },
				400,
			);
		}
		const result = await calendar.createEvent(
			body.title,
			body.startDate,
			body.endDate,
			typeof body.location === "string" ? body.location : undefined,
			typeof body.notes === "string" ? body.notes : undefined,
			typeof body.isAllDay === "boolean" ? body.isAllDay : undefined,
			typeof body.calendarName === "string" ? body.calendarName : undefined,
		);
		if (!result.success) {
			return c.json({ error: result.message ?? "failed to create event" }, 500);
		}
		return c.json({ data: result }, 201);
	});

	return r;
}
