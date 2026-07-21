import { Hono } from "hono";
import contacts from "../../utils/contacts.js";
import { readPageParams, paginate, envelope } from "./pagination.js";

export function contactsRoutes(): Hono {
	const r = new Hono();
	r.get("/", async (c) => {
		const url = new URL(c.req.url);
		const { limit, offset } = readPageParams(url);
		const name = url.searchParams.get("name");

		let rows: { name: string; phones: string[] }[];
		if (name) {
			const phones = await contacts.findNumber(name);
			rows = phones.length ? [{ name, phones }] : [];
		} else {
			const all = await contacts.getAllNumbers();
			rows = Object.entries(all).map(([n, phones]) => ({
				name: n,
				phones: phones as string[],
			}));
		}
		return c.json(envelope(paginate(rows, limit, offset), limit, offset));
	});
	return r;
}
