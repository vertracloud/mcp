import type { RESTPatchAPIApplicationUpdateConfigBody } from "@vertracloud/api-types/v1";
import { z } from "zod";
import { fileName, writeLocalFile, zipDirectory } from "../local.js";
import { fail, ok, respond } from "../result.js";
import { D, R, W, WI, type ToolDefinition } from "./defs.js";
import { enc, guardLocal, pick, str } from "./util.js";

const POLL_MS = 2_000;
const BUILD_ERROR_HINT =
	"What to do by `last_build_error`: INSTALL_OUT_OF_MEMORY, raise the app memory; BUILD_FAILED or INSTALL_FAILED, read `get_logs` and fix the project; BUILD_TIMEOUT or INSTALL_TIMEOUT, make the build or install shorter; BUILD_INTERRUPTED, try again; INSTALL_SHIELD_BLOCKED, the network protection blocked traffic during the build.";
const id = z.string().min(1).describe("Application ID");
const workspace_id = z.string().optional().describe("ID of the workspace that owns the resource, if any");

export const appsTools: ToolDefinition[] = [
	{
		name: "list_apps",
		description: "Lists the account's applications with the current status of each.",
		group: "apps",
		route: ["GET", "/v1/apps/status"],
		annotations: R,
		inputSchema: {},
		handler: (_args, client) => client.get("/v1/apps/status").then((r) => respond(r)),
	},
	{
		name: "get_app",
		description: `Details of an application: name, status (up, down or building), memory, runtime, main file, publication. When a build or install failed, \`last_build_error\` holds the code (null otherwise). ${BUILD_ERROR_HINT}`,
		group: "apps",
		route: ["GET", "/v1/apps/:id"],
		annotations: R,
		inputSchema: { id, workspace_id },
		handler: (args, client) =>
			client.get(`/v1/apps/${enc(args.id)}`, { workspace_id: str(args.workspace_id) }).then((r) => respond(r)),
	},
	{
		name: "get_app_status",
		description: "Live status (CPU, RAM, uptime) of an application; without `id`, of all of them.",
		group: "apps",
		route: ["GET", "/v1/apps/:id/status"],
		annotations: R,
		inputSchema: { id: id.optional(), workspace_id },
		handler: (args, client) => {
			const appId = str(args.id);
			const path = appId ? `/v1/apps/${enc(appId)}/status` : "/v1/apps/status";
			return client.get(path, { workspace_id: str(args.workspace_id) }).then((r) => respond(r));
		},
	},
	{
		name: "wait_for_app",
		description:
			`Waits up to \`timeout_seconds\` (max 25, default 20) for an application to leave the "building" status. Returns the app; \`status\` is "up" (ready), "down" (build failed; \`last_build_error\` says why) or still "building" (call again). ${BUILD_ERROR_HINT}`,
		group: "apps",
		route: ["GET", "/v1/apps/:id"],
		annotations: R,
		inputSchema: {
			id,
			timeout_seconds: z.number().int().min(1).max(25).optional().describe("Maximum wait in seconds (default 20, max 25)"),
			workspace_id,
		},
		handler: async (args, client) => {
			const deadline = Date.now() + Math.min(Number(args.timeout_seconds ?? 20), 25) * 1000;
			for (;;) {
				const res = await client.get<{ status?: string }>(`/v1/apps/${enc(args.id)}`, { workspace_id: str(args.workspace_id) });
				if (!res.ok || (res.body as { status?: string })?.status !== "building" || Date.now() + POLL_MS > deadline) return respond(res);
				await new Promise((r) => setTimeout(r, POLL_MS));
			}
		},
	},
	{
		name: "get_logs",
		description:
			"Last lines of the application's log (snapshot, not real time). `tail` trims the last N lines of what the API returned.",
		group: "apps",
		route: ["GET", "/v1/apps/:id/logs"],
		annotations: R,
		inputSchema: { id, tail: z.number().int().positive().optional().describe("Number of trailing lines"), workspace_id },
		handler: async (args, client) => {
			const res = await client.get<unknown>(`/v1/apps/${enc(args.id)}/logs`, { workspace_id: str(args.workspace_id) });
			const tail = args.tail as number | undefined;
			return respond(res, (body) => {
				const logs = typeof body === "string" ? body : (body as { logs?: string })?.logs;
				if (typeof logs !== "string" || !tail) return body;
				return logs.split("\n").slice(-tail).join("\n");
			});
		},
	},
	{
		name: "get_metrics",
		description: "History of CPU, RAM, storage and network usage of the application.",
		group: "apps",
		route: ["GET", "/v1/apps/:id/metrics"],
		annotations: R,
		inputSchema: { id, range: z.enum(["10m", "30m", "24h"]).optional(), workspace_id },
		handler: (args, client) =>
			client
				.get(`/v1/apps/${enc(args.id)}/metrics`, { range: str(args.range), workspace_id: str(args.workspace_id) })
				.then((r) => respond(r)),
	},
	{
		name: "list_runtimes",
		description: "Languages and versions the platform accepts.",
		group: "apps",
		route: ["GET", "/v1/apps/runtimes"],
		annotations: R,
		inputSchema: {},
		handler: (_args, client) => client.get("/v1/apps/runtimes").then((r) => respond(r)),
	},
	{
		name: "start_app",
		description: "Turns the application on.",
		group: "apps",
		route: ["POST", "/v1/apps/:id/start"],
		annotations: WI,
		inputSchema: { id, workspace_id },
		handler: (args, client) =>
			client.post(`/v1/apps/${enc(args.id)}/start`, undefined, { workspace_id: str(args.workspace_id) }).then((r) => respond(r)),
	},
	{
		name: "restart_app",
		description:
			"Restarts the application. `reinstall_dependencies` reinstalls dependencies from scratch (ignoring the install cache); `force_build` runs the build command again even without a code change. Both count as a deploy against the plan's hourly limit.",
		group: "apps",
		route: ["POST", "/v1/apps/:id/restart"],
		annotations: W,
		inputSchema: {
			id,
			workspace_id,
			reinstall_dependencies: z.boolean().optional().describe("Reinstall dependencies from scratch"),
			force_build: z.boolean().optional().describe("Run the build command again even without a change"),
		},
		handler: (args, client) =>
			client
				.post(
					`/v1/apps/${enc(args.id)}/restart`,
					args.reinstall_dependencies || args.force_build ? { reinstall_dependencies: args.reinstall_dependencies, force_build: args.force_build } : undefined,
					{ workspace_id: str(args.workspace_id) },
				)
				.then((r) => respond(r)),
	},
	{
		name: "stop_app",
		description: "Turns the application off.",
		group: "apps",
		route: ["POST", "/v1/apps/:id/stop"],
		annotations: WI,
		inputSchema: { id, workspace_id },
		handler: (args, client) =>
			client.post(`/v1/apps/${enc(args.id)}/stop`, undefined, { workspace_id: str(args.workspace_id) }).then((r) => respond(r)),
	},
	{
		name: "create_app",
		description:
			"Creates an application from a folder on the computer: compresses the folder (ignoring node_modules, .git and whatever is in .vertraignore) and uploads it. Asynchronous: returns right away with the app in status \"building\"; install and build continue in the background. Call `wait_for_app` (or `get_app` / `get_app_status`) until the status is \"up\" or \"down\"; if \"down\", `last_build_error` has the code and `get_logs` the detail. " + BUILD_ERROR_HINT + " While it builds, restart/start/stop/deploy/rollback return 409 APP_BUILDING. Accounts without a plan get PLAN_REQUIRED: a paid plan is needed first.",
		group: "apps",
		route: ["POST", "/v1/apps"],
		local: true,
		annotations: W,
		inputSchema: {
			path: z.string().describe("Project folder on the computer"),
			name: z.string().describe("Application name"),
			memory: z.number().int().positive().describe("RAM in MB"),
			main: z.string().describe("Main file (e.g. index.js)"),
			version: z.string().optional().describe('Runtime version; "recommended" by default'),
			description: z.string().optional(),
			subdomain: z.string().optional(),
			start: z.string().optional().describe("Custom start command"),
			build: z.string().optional().describe("Build command, run after install"),
			workspace_id: z.string().optional(),
		},
		handler: (args, client) =>
			guardLocal(async () => {
				const zip = zipDirectory(String(args.path));
				const form = new FormData();
				form.append("file", new Blob([new Uint8Array(zip)]), `${fileName(String(args.path))}.zip`);
				form.append("name", String(args.name));
				form.append("memory", String(args.memory));
				form.append("main", String(args.main));
				form.append("version", str(args.version) ?? "recommended");
				for (const field of ["description", "subdomain", "start", "build", "workspace_id"] as const) {
					const value = str(args[field]);
					if (value) form.append(field, value);
				}
				return respond(await client.postMultipart("/v1/apps", form));
			}),
	},
	{
		name: "deploy_app",
		description:
			"Uploads a folder from the computer to an existing application (new deploy), using the same compression criteria as `create_app`. Returns 409 APP_BUILDING if the application is still in its first build: wait with `wait_for_app` first.",
		group: "apps",
		route: ["POST", "/v1/apps/:id/files/upload"],
		local: true,
		annotations: W,
		inputSchema: {
			id,
			path: z.string().describe("Project folder on the computer"),
			restart: z.boolean().optional().describe("Restart the application after upload (default: true)"),
			message: z.string().max(500).optional().describe("Message shown in the release history (up to 500 characters)"),
			workspace_id: z.string().optional(),
		},
		handler: (args, client) =>
			guardLocal(async () => {
				const zip = zipDirectory(String(args.path));
				const form = new FormData();
				form.append("file", new Blob([new Uint8Array(zip)]), `${fileName(String(args.path))}.zip`);
				const restart = args.restart === undefined ? true : Boolean(args.restart);
				const message = str(args.message);
				if (message) form.append("message", message);
				return respond(
					await client.postMultipart(`/v1/apps/${enc(args.id)}/files/upload`, form, {
						restart: String(restart),
						workspace_id: str(args.workspace_id),
					}),
				);
			}),
	},
	{
		name: "update_app_config",
		description: "Changes the application's configuration: name, memory, main file, runtime version, start command, build command and deploy behavior (`zero_downtime`, `auto_rollback`, `health_check_path`). Zero downtime \"on\" and auto rollback depend on the plan (PLAN_DOES_NOT_SUPPORT_ZERO_DOWNTIME / PLAN_DOES_NOT_SUPPORT_AUTO_ROLLBACK).",
		group: "apps",
		route: ["PATCH", "/v1/apps/:id/config"],
		annotations: WI,
		inputSchema: {
			id,
			name: z.string().optional(),
			description: z.string().optional(),
			memory: z.number().int().positive().optional(),
			main: z.string().optional(),
			version: z.string().optional(),
			start: z.string().optional(),
			build: z.string().optional().describe("Build command; empty string removes it"),
			zero_downtime: z.enum(["auto", "on", "off"]).optional().describe("Deploy without downtime: auto, on or off"),
			auto_rollback: z.boolean().optional().describe("Automatically roll back a deploy that fails to start"),
			health_check_path: z
				.string()
				.max(200)
				.regex(/^\/[\x21-\x7e]*$/)
				.nullable()
				.optional()
				.describe("Health check path: starts with /, printable ASCII without spaces, up to 200 characters; null clears it"),
			workspace_id: z.string().optional(),
		},
		handler: (args, client) => {
			// Agent-friendly parameter names (`memory`/`main`/`start`) are not the wire names
			// (`ram`/`main_file`/`start_command`) — sending the wrong key makes the API
			// discard the field and fail with "no field provided".
			const body: RESTPatchAPIApplicationUpdateConfigBody = {
				...pick(args, ["name", "description", "version"]),
				...(args.memory !== undefined ? { ram: Number(args.memory) } : {}),
				...(args.main !== undefined ? { main_file: String(args.main) } : {}),
				...(args.start !== undefined ? { start_command: String(args.start) } : {}),
				...(args.build !== undefined ? { build_command: String(args.build) || null } : {}),
			};
			const deploy = pick(args, ["zero_downtime", "auto_rollback", "health_check_path"]);
			if (Object.keys(deploy).length) body.deploy = deploy as NonNullable<RESTPatchAPIApplicationUpdateConfigBody["deploy"]>;
			return client
				.patch(`/v1/apps/${enc(args.id)}/config`, body, { workspace_id: str(args.workspace_id) })
				.then((r) => respond(r));
		},
	},
	{
		name: "download_app",
		description: "Downloads the application's files as a zip and writes it to the given path.",
		group: "apps",
		route: ["GET", "/v1/apps/:id/download"],
		local: true,
		annotations: R,
		inputSchema: { id, dest: z.string().describe("Path of the .zip file to write"), workspace_id },
		handler: (args, client) =>
			guardLocal(async () => {
				const res = await client.download(`/v1/apps/${enc(args.id)}/download`, { workspace_id: str(args.workspace_id) });
				if (!res.ok) return fail(res.body);
				return ok(writeLocalFile(String(args.dest), res.body as Uint8Array));
			}),
	},
	{
		name: "delete_app",
		description: "Permanently deletes the application, along with its files and configuration.",
		group: "apps",
		route: ["DELETE", "/v1/apps/:id"],
		annotations: D,
		inputSchema: { id, workspace_id },
		handler: (args, client) =>
			client.delete(`/v1/apps/${enc(args.id)}`, { workspace_id: str(args.workspace_id) }).then((r) => respond(r)),
	},
];
