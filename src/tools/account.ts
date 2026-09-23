import { z } from "zod";
import { respond } from "../result.js";
import { R, WI, type ToolDefinition } from "./defs.js";
import { pick } from "./util.js";

export const accountTools: ToolDefinition[] = [
	{
		name: "get_profile",
		description: "Account profile: plan, allocated memory, limits and usage.",
		group: "account",
		route: ["GET", "/v1/users/me"],
		annotations: R,
		inputSchema: {},
		handler: (_args, client) => client.get("/v1/users/me").then((r) => respond(r)),
	},
	{
		name: "update_profile",
		description: "Changes the account's display name or language.",
		group: "account",
		route: ["PATCH", "/v1/users/me"],
		annotations: WI,
		inputSchema: { name: z.string().optional(), language: z.string().optional() },
		handler: (args, client) => client.patch("/v1/users/me", pick(args, ["name", "language"])).then((r) => respond(r)),
	},
	{
		name: "list_sessions",
		description: "Open login sessions on the account (no IP or location).",
		group: "account",
		route: ["GET", "/v1/users/me/sessions"],
		annotations: R,
		inputSchema: {},
		// The route returns IP and location; none of that needs to enter the model's context.
		handler: (_args, client) =>
			client.get("/v1/users/me/sessions").then((r) =>
				respond(r, (body) => {
					const list = Array.isArray(body) ? body : ((body as { sessions?: unknown[] } | null)?.sessions ?? []);
					return list.map((entry) => {
						const session = (entry ?? {}) as Record<string, unknown>;
						return pick(session, ["id", "provider", "is_current", "created_at", "expires_at", "last_used_at"]);
					});
				}),
			),
	},
];
