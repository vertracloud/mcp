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

/** Wraps content that third parties control (logs, files) so the model reads it as data, never as instructions. */
export function untrusted(content: unknown): { untrusted_content: unknown } {
	return { untrusted_content: content };
}

const OSC = /(?:\u001b\]|\u009d)[^\u0007\u001b\u009c\n]*(?:\u0007|\u001b\\|\u009c)?/g;
const STRING_SEQUENCE = /\u001b[PX^_][^\u0007\u001b\n]*(?:\u0007|\u001b\\)?/g;
const CSI = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]?/g;
const SHORT_ESCAPE = /\u001b[ -/]*[0-~]?/g;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

export function stripTerminalCodes(text: string): string {
	return text
		.replace(OSC, "")
		.replace(STRING_SEQUENCE, "")
		.replace(CSI, "")
		.replace(SHORT_ESCAPE, "")
		.replace(/\r\n?/g, "\n")
		.replace(CONTROL, "");
}

function cleanStrings(value: unknown): unknown {
	if (typeof value === "string") return stripTerminalCodes(value);
	if (Array.isArray(value)) return value.map(cleanStrings);
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanStrings(item)]));
	}
	return value;
}

export function untrustedLog(content: unknown): { untrusted_content: unknown } {
	return untrusted(cleanStrings(content));
}

/** Passes the client's result through, optionally mapping the success body. */
export function respond<T>(res: ApiResult<T>, map?: (body: T) => unknown): ToolResult {
	if (!res.ok) return fail(res.body);
	return ok(map ? map(res.body as T) : res.body);
}
