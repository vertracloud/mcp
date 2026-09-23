import { z } from "zod";
import { writeLocalFile } from "../local.js";
import { fail, ok, respond } from "../result.js";
import { D, R, W, type ToolDefinition } from "./defs.js";
import { enc, guardLocal, str } from "./util.js";

const scope = z.enum(["applications", "databases"]).describe("Resource type");
const resource_id = z.string().describe("Application or database ID");

export const snapshotsTools: ToolDefinition[] = [
	{
		name: "list_snapshots",
		description: "Snapshots of a resource; without `resource_id`, snapshots of every resource of that type.",
		group: "snapshots",
		route: ["GET", "/v1/users/:id/snapshots"],
		annotations: R,
		inputSchema: { scope, resource_id: resource_id.optional() },
		handler: (args, client) => {
			const id = str(args.resource_id);
			const path = id ? `/v1/users/${enc(id)}/snapshots` : "/v1/users/snapshots";
			return client.get(path, { scope: String(args.scope) }).then((r) => respond(r));
		},
	},
	{
		name: "create_snapshot",
		description: "Takes a snapshot of the resource. Counts against the plan's snapshot quota.",
		group: "snapshots",
		route: ["POST", "/v1/users/:id/snapshots"],
		annotations: W,
		inputSchema: { scope, resource_id },
		handler: (args, client) =>
			client
				.post(`/v1/users/${enc(args.resource_id)}/snapshots`, undefined, { scope: String(args.scope) })
				.then((r) => respond(r)),
	},
	{
		name: "restore_snapshot",
		description: "Restores a snapshot OVER the resource: the current content is replaced.",
		group: "snapshots",
		route: ["POST", "/v1/users/:id/snapshots/:snapshot_id/restore"],
		annotations: D,
		inputSchema: { scope, resource_id, snapshot_id: z.string(), target_id: z.string().optional().describe("Restore into a different resource") },
		handler: (args, client) =>
			client
				.post(
					`/v1/users/${enc(args.resource_id)}/snapshots/${enc(args.snapshot_id)}/restore`,
					args.target_id ? { resource_id: String(args.target_id) } : undefined,
					{ scope: String(args.scope) },
				)
				.then((r) => respond(r)),
	},
	{
		name: "download_snapshot",
		description: "Downloads a snapshot and writes it to the given path on the computer.",
		group: "snapshots",
		route: ["GET", "/v1/users/:id/snapshots/:snapshot_id/download"],
		local: true,
		annotations: R,
		inputSchema: { scope, resource_id, snapshot_id: z.string(), dest: z.string().describe("Path of the file to write") },
		handler: (args, client) =>
			guardLocal(async () => {
				const res = await client.download(`/v1/users/${enc(args.resource_id)}/snapshots/${enc(args.snapshot_id)}/download`, {
					scope: String(args.scope),
				});
				if (!res.ok) return fail(res.body);
				return ok(writeLocalFile(String(args.dest), res.body as Uint8Array));
			}),
	},
];
