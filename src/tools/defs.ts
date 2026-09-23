import { API_KEY_SCOPES, type APIApiKeyScope } from "@vertracloud/api-types/payloads/v1";
import type { ZodRawShape, ZodTypeAny, z } from "zod";
import type { VertraClient } from "../client.js";
import type { ToolResult } from "../result.js";

export type ToolGroup =
	| "docs"
	| "apps"
	| "deploys"
	| "envs"
	| "files"
	| "network"
	| "databases"
	| "snapshots"
	| "account"
	| "workspaces"
	| "billing";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/** Route in the catalog's format (`["GET", "/v1/apps/:id/logs"]`), not the final URL. */
export type CatalogRoute = [HttpMethod, string];

export interface ToolAnnotations {
	readOnlyHint: boolean;
	destructiveHint: boolean;
	idempotentHint: boolean;
}

export interface ToolDefinition {
	name: string;
	description: string;
	group: ToolGroup;
	/** Main route; the required scope is DERIVED from it via the `API_KEY_SCOPES` catalog. */
	route?: CatalogRoute;
	/** Only when the tool doesn't talk to the API (`get_docs`) or uses a route already covered by another tool. */
	scope?: APIApiKeyScope | null;
	/** Only works on the local transport (stdio): reads or writes to the user's disk. */
	local?: boolean;
	annotations: ToolAnnotations;
	inputSchema: ZodRawShape | ZodTypeAny;
	handler: (args: Record<string, unknown>, client: VertraClient) => Promise<ToolResult>;
}

/** Ready-made annotations: read, write and destructive. */
export const R: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
export const W: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
export const WI: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
export const D: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false };

/** The scope required by a route, read from the public catalog (single source of truth). */
export function scopeForRoute(method: HttpMethod, path: string): APIApiKeyScope | null {
	for (const [scope, entry] of Object.entries(API_KEY_SCOPES)) {
		if (entry.routes.some((route) => route.method === method && route.path === path)) {
			return scope as APIApiKeyScope;
		}
	}
	return null;
}

/** The scope of a tool: the declared one, or the one derived from the route. */
export function toolScope(tool: ToolDefinition): APIApiKeyScope | null {
	if (tool.scope !== undefined) return tool.scope;
	return tool.route ? scopeForRoute(tool.route[0], tool.route[1]) : null;
}

/** Convenience typing for group handlers. */
export type Args<S extends ZodRawShape> = { [K in keyof S]: S[K] extends ZodTypeAny ? z.infer<S[K]> : never };
