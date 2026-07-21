/**
 * Parse an AppleScript-localized date string, e.g.
 * "Thursday, July 30, 2026 at 12:00:00 AM", into a Date (local time).
 * Returns null for empty/"missing value"/unparseable input.
 * Values that already parse as dates (e.g. ISO strings) are handled too.
 */
export function parseAppleScriptDate(s: string | null | undefined): Date | null {
	if (!s || s === "missing value") return null;
	const cleaned = s.replace(/^[A-Za-z]+,\s*/, "").replace(/\s+at\s+/, " ");
	const d = new Date(cleaned);
	return Number.isNaN(d.getTime()) ? null : d;
}

/** Convert an AppleScript-localized date string to an ISO 8601 string, or null. */
export function appleScriptDateToISO(
	s: string | null | undefined,
): string | null {
	const d = parseAppleScriptDate(s);
	return d ? d.toISOString() : null;
}
