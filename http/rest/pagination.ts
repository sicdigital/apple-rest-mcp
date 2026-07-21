export interface Envelope<T> {
	data: T[];
	pagination: { limit: number; offset: number; count: number };
}

export function readPageParams(url: URL): { limit: number; offset: number } {
	const limit = Math.min(
		Math.max(Number(url.searchParams.get("limit") ?? 100), 1),
		1000,
	);
	const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
	return { limit, offset };
}

export function paginate<T>(items: T[], limit: number, offset: number): T[] {
	return items.slice(offset, offset + limit);
}

export function envelope<T>(
	data: T[],
	limit: number,
	offset: number,
): Envelope<T> {
	return { data, pagination: { limit, offset, count: data.length } };
}
