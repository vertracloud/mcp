import type { ApiResult } from "./client.js";

export interface ToolResult {
	content: { type: "text"; text: string }[];
	isError?: boolean;
}

function text(value: unknown): ToolResult["content"] {
	return [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }];
}

/** Success: the data serialized into `content`. */
export function ok(data: unknown): ToolResult {
	return { content: text(data ?? { ok: true }) };
}

/** Error: `isError` + the API's `{ code, message?, details? }` envelope, untouched. */
export function fail(envelope: unknown): ToolResult {
	return { isError: true, content: text(envelope) };
}

/** Passes the client's result through, optionally mapping the success body. */
export function respond<T>(res: ApiResult<T>, map?: (body: T) => unknown): ToolResult {
	if (!res.ok) return fail(res.body);
	return ok(map ? map(res.body as T) : res.body);
}
