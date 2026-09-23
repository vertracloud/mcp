import type { FetchLike } from "./client.js";

export const DOCS_BASE_URL = "https://docs.vertracloud.app";
const KB_PATHS = ["/knowledge-base.md", "/knowledge-base"];
const TTL_MS = 60 * 60 * 1000;

let cache: { text: string; at: number } | null = null;

/** For tests only: clears the in-memory cache. */
export function resetDocsCache(): void {
	cache = null;
}

/** Fetches the public knowledge base, with a 1h in-memory cache. */
export async function fetchKnowledgeBase(fetchImpl: FetchLike = globalThis.fetch, now = Date.now()): Promise<string> {
	if (cache && now - cache.at < TTL_MS) return cache.text;

	let lastError = "";
	for (const path of KB_PATHS) {
		try {
			const res = await fetchImpl(DOCS_BASE_URL + path, { signal: AbortSignal.timeout(20_000) });
			if (res.ok) {
				const text = await res.text();
				cache = { text, at: now };
				return text;
			}
			lastError = `HTTP_${res.status}`;
		} catch (err) {
			lastError = err instanceof Error ? err.message : String(err);
		}
	}
	throw new Error(lastError || "unavailable");
}

/** Slices out the section whose markdown heading contains `section` (case-insensitive). */
export function sliceSection(markdown: string, section: string): string | null {
	const lines = markdown.split(/\r?\n/);
	const needle = section.toLowerCase();
	let start = -1;
	let level = 0;

	for (let i = 0; i < lines.length; i++) {
		const match = /^(#{1,6})\s+(.*)$/.exec(lines[i] ?? "");
		if (!match) continue;
		if (start === -1) {
			if ((match[2] ?? "").toLowerCase().includes(needle)) {
				start = i;
				level = (match[1] ?? "").length;
			}
			continue;
		}
		if ((match[1] ?? "").length <= level) return lines.slice(start, i).join("\n").trim();
	}
	return start === -1 ? null : lines.slice(start).join("\n").trim();
}
