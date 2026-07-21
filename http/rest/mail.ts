import { Hono } from "hono";
import mail from "../../utils/mail.js";
import { readPageParams, paginate, envelope } from "./pagination.js";

export function mailRoutes(): Hono {
	const r = new Hono();

	r.get("/", async (c) => {
		const url = new URL(c.req.url);
		const { limit, offset } = readPageParams(url);
		const account = url.searchParams.get("account") ?? undefined;
		const q = url.searchParams.get("q");
		const unread = url.searchParams.get("unread") === "true";

		let rows: unknown[];
		if (q) {
			rows = await mail.searchMails(q, limit);
		} else if (unread) {
			rows = await mail.getUnreadMails(limit);
		} else {
			// getLatestMails requires an account; default to the first configured one.
			let acct = account;
			if (!acct) {
				const accounts = await mail.getAccounts();
				if (accounts.length === 0) {
					return c.json(envelope([], limit, offset));
				}
				acct = accounts[0];
			}
			rows = await mail.getLatestMails(acct, limit);
		}

		return c.json(envelope(paginate(rows, limit, offset), limit, offset));
	});

	r.get("/accounts", async (c) => {
		const rows = await mail.getAccounts();
		return c.json(envelope(rows, rows.length, 0));
	});

	r.get("/mailboxes", async (c) => {
		const account = new URL(c.req.url).searchParams.get("account");
		const rows = account
			? await mail.getMailboxesForAccount(account)
			: await mail.getMailboxes();
		return c.json(envelope(rows, rows.length, 0));
	});

	return r;
}
