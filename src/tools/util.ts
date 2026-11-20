import { z } from "zod";
import type { Query, VertraClient } from "../client.js";
import { LocalError, openLocalDestination } from "../local.js";
import { type ToolResult, fail, ok } from "../result.js";

function isDotSegment(segment: string): boolean {
	let current = segment;
	for (let i = 0; i < 4; i++) {
		if (current === "" || current === "." || current === "..") return true;
		let decoded: string;
		try {
			decoded = decodeURIComponent(current);
		} catch {
			return false;
		}
		if (decoded === current) return false;
		current = decoded;
	}
	return false;
}

/**
 * URL segment coming from the agent: escaped, and empty/`.`/`..` rejected — also when
 * percent-encoded. Node's `URL` normalizes `..` and the tool would end up hitting a different
 * route than the one it advertised to the MCP client.
 */
export function enc(value: unknown): string {
	const segment = String(value);
	if (isDotSegment(segment)) {
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

/**
 * Downloads `apiPath` straight into `dest` (inside the allowed root, never overwriting): the bytes go to disk as they arrive, through a temporary file
 * that gets the final name only when the body ends. An API error, a stall, a cancellation or a disk failure removes it.
 */
export async function downloadToLocal(client: VertraClient, apiPath: string, query: Query, dest: string): Promise<ToolResult> {
	const target = await openLocalDestination(dest);
	try {
		const res = await client.downloadInto(apiPath, query, target);
		if (!res.ok) {
			await target.abort();
			return fail(res.body);
		}
		await target.commit();
		return ok({ path: target.path, bytes: (res.body as { bytes: number }).bytes });
	} catch (err) {
		await target.abort();
		throw err;
	}
}
