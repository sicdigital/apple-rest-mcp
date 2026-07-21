import { Hono } from "hono";
import reminders from "../../utils/reminders.js";
import { readPageParams, paginate, envelope } from "./pagination.js";

export function remindersRoutes(): Hono {
	const r = new Hono();
	r.get("/", async (c) => {
		const url = new URL(c.req.url);
		const { limit, offset } = readPageParams(url);
		const list = url.searchParams.get("list");
		const listId = url.searchParams.get("listId");
		const q = url.searchParams.get("q");

		let rows: unknown[];
		if (q) rows = await reminders.searchReminders(q);
		else if (listId) rows = await reminders.getRemindersFromListById(listId);
		else if (list) rows = await reminders.getAllReminders(list);
		else rows = await reminders.getAllReminders();

		return c.json(envelope(paginate(rows, limit, offset), limit, offset));
	});
	return r;
}
