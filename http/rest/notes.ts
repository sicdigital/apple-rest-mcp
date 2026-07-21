import { Hono } from "hono";
import notes from "../../utils/notes.js";
import { requireFullScope } from "../auth.js";
import { readPageParams, paginate, envelope } from "./pagination.js";

interface NoteRow {
	name: string;
	content: string;
}

export function notesRoutes(): Hono {
	const r = new Hono();
	r.get("/", async (c) => {
		const url = new URL(c.req.url);
		const { limit, offset } = readPageParams(url);
		const folder = url.searchParams.get("folder");
		const from = url.searchParams.get("from") ?? undefined;
		const to = url.searchParams.get("to") ?? undefined;
		const q = url.searchParams.get("q")?.toLowerCase();

		// Folder-scoped queries return { success, notes? }; getAllNotes returns Note[].
		let rows: NoteRow[];
		if (folder && (from || to)) {
			const res = await notes.getNotesByDateRange(folder, from, to, limit);
			rows = res.notes ?? [];
		} else if (folder) {
			const res = await notes.getNotesFromFolder(folder);
			rows = res.notes ?? [];
		} else {
			rows = await notes.getAllNotes();
		}

		if (q) {
			rows = rows.filter(
				(n) =>
					n.name.toLowerCase().includes(q) ||
					n.content.toLowerCase().includes(q),
			);
		}
		return c.json(envelope(paginate(rows, limit, offset), limit, offset));
	});

	// Create a note (full token only).
	r.post("/", requireFullScope(), async (c) => {
		let body: { title?: unknown; body?: unknown; folderName?: unknown };
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "invalid JSON body" }, 400);
		}
		if (typeof body.title !== "string" || body.title.trim() === "") {
			return c.json({ error: "title is required" }, 400);
		}
		if (typeof body.body !== "string" || body.body === "") {
			return c.json({ error: "body is required" }, 400);
		}
		const result = await notes.createNote(
			body.title,
			body.body,
			typeof body.folderName === "string" ? body.folderName : undefined,
		);
		if (!result.success) {
			return c.json({ error: result.message ?? "failed to create note" }, 500);
		}
		return c.json({ data: result }, 201);
	});

	return r;
}
