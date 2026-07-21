import { Hono } from "hono";
import calendar from "../../utils/calendar.js";
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
	return r;
}
