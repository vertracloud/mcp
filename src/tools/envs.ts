import { z } from "zod";
import { ok, respond } from "../result.js";
import { D, R, WI, type ToolDefinition } from "./defs.js";
import { enc, str } from "./util.js";

const id = z.string().describe("Application ID");
const workspace_id = z.string().optional();

/**
 * THE VALUE NEVER LEAVES THIS FILE. The route returns it decrypted; the tool discards it before responding.
 * Everything a tool returns enters the model's context — and from there the chat and history.
 */
function keysOnly(body: unknown): unknown {
	const list = Array.isArray(body) ? body : (body as { envs?: unknown[] } | null)?.envs;
	if (!Array.isArray(list)) return { variables: [] };
	return {
		variables: list.map((entry) => {
			const env = (entry ?? {}) as Record<string, unknown>;
			const out: Record<string, unknown> = { key: env.key };
			if (env.id !== undefined) out.id = env.id;
			if (env.updated_at !== undefined) out.updated_at = env.updated_at;
			else if (env.created_at !== undefined) out.created_at = env.created_at;
			return out;
		}),
		note: "Values are not returned by this server, for security.",
	};
}

export const envsTools: ToolDefinition[] = [
	{
		name: "list_envs",
		description:
			"Lists the NAMES of the application's environment variables. The value is never returned — no tool reads a variable's value.",
		group: "envs",
		route: ["GET", "/v1/apps/:id/envs"],
		annotations: R,
		inputSchema: { id, workspace_id },
		handler: async (args, client) => {
			const res = await client.get(`/v1/apps/${enc(args.id)}/envs`, { workspace_id: str(args.workspace_id) });
			return respond(res, keysOnly);
		},
	},
	{
		name: "set_env",
		description: "Creates or overwrites an application environment variable. The response confirms the key, without echoing the value.",
		group: "envs",
		route: ["POST", "/v1/apps/:id/envs"],
		annotations: WI,
		inputSchema: {
			id,
			key: z.string().describe("Variable name"),
			value: z.string().describe("Variable value"),
			note: z.string().optional().describe("Free-form description"),
			workspace_id,
		},
		handler: async (args, client) => {
			const entry = { key: String(args.key), value: String(args.value), note: str(args.note) };
			const res = await client.post(`/v1/apps/${enc(args.id)}/envs`, [entry], { workspace_id: str(args.workspace_id) });
			return res.ok ? ok({ key: entry.key, ok: true }) : respond(res);
		},
	},
	{
		name: "delete_env",
		description: "Deletes an environment variable. Use the variable `id` returned by `list_envs`.",
		group: "envs",
		route: ["DELETE", "/v1/apps/:id/envs/:envId"],
		annotations: D,
		inputSchema: { id, env_id: z.string().describe("Variable ID"), workspace_id },
		handler: (args, client) =>
			client
				.delete(`/v1/apps/${enc(args.id)}/envs/${enc(args.env_id)}`, { workspace_id: str(args.workspace_id) })
				.then((r) => respond(r)),
	},
];
