import { LocalError } from "../local.js";
import { type ToolResult, fail } from "../result.js";

/**
 * URL segment coming from the agent: escaped, and `.`/`..`/empty rejected — Node's `URL`
 * normalizes `..` and the tool would end up hitting a different route than the one it
 * advertised to the MCP client.
 */
export function enc(value: unknown): string {
	const segment = String(value);
	if (segment === "" || segment === "." || segment === "..") {
		throw new LocalError("INVALID_ID", `Invalid identifier: "${segment}".`);
	}
	return encodeURIComponent(segment);
}

export function str(value: unknown): string | undefined {
	return value === undefined || value === null ? undefined : String(value);
}

/** Only the keys that are present, to build a PATCH/PUT body without sending `undefined`. */
export function pick(args: Record<string, unknown>, keys: string[]): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of keys) if (args[key] !== undefined) out[key] = args[key];
	return out;
}

/** A disk error becomes an envelope, same shape as the API's. */
export async function guardLocal(run: () => Promise<ToolResult>): Promise<ToolResult> {
	try {
		return await run();
	} catch (err) {
		if (err instanceof LocalError) return fail({ code: err.code, message: err.message });
		return fail({ code: "LOCAL_ERROR", message: err instanceof Error ? err.message : String(err) });
	}
}
