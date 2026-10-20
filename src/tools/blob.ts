import { z } from "zod";
import { readLocalFile } from "../local.js";
import { respond } from "../result.js";
import { D, R, WI, type ToolDefinition } from "./defs.js";
import { enc, guardLocal, str } from "./util.js";

// `route` uses the catalog's own format so the scope is derived from it; the request goes to the Blob host
// (`client.blobClient()`) with the short paths below.

/** Largest file the single-request upload accepts (`POST /v1/objects`). */
export const MAX_SIMPLE_UPLOAD_BYTES = 100 * 1024 * 1024;

const id = z.string().min(1).describe("Blob object ID");
const workspace_id = z.string().optional();
const visibility = z.enum(["public", "private"]);

export const blobTools: ToolDefinition[] = [
	{
		name: "list_blob_objects",
		description: "Lists the files of Blob Storage. Use `prefix` to look in a folder and `delimiter` \"/\" to get the folders back.",
		group: "blob",
		route: ["GET", "/v1/blob/objects"],
		annotations: R,
		inputSchema: {
			prefix: z.string().optional().describe("Only paths that start with this"),
			delimiter: z.literal("/").optional().describe('Groups paths into folders; only "/" is accepted'),
			visibility: visibility.optional(),
			cursor: z.string().optional().describe("Cursor of the next page, from the previous result"),
			limit: z.number().int().min(1).max(1000).optional().describe("Items per page (1-1000, default 100)"),
			workspace_id,
		},
		handler: (args, client) =>
			client
				.blobClient()
				.get("/objects", {
					prefix: str(args.prefix),
					delimiter: str(args.delimiter),
					visibility: str(args.visibility),
					cursor: str(args.cursor),
					limit: args.limit === undefined ? undefined : Number(args.limit),
					workspace_id: str(args.workspace_id),
				})
				.then((r) => respond(r)),
	},
	{
		name: "get_blob_object",
		description: "Returns the details of one Blob Storage file: path, size, type, visibility and public URL.",
		group: "blob",
		route: ["GET", "/v1/blob/objects/:object_id"],
		annotations: R,
		inputSchema: { id, workspace_id },
		handler: (args, client) =>
			client
				.blobClient()
				.get(`/objects/${enc(args.id)}`, { workspace_id: str(args.workspace_id) })
				.then((r) => respond(r)),
	},
	{
		name: "upload_blob",
		description: `Uploads a file from the computer to Blob Storage (up to ${MAX_SIMPLE_UPLOAD_BYTES / 1024 / 1024} MB). Private by default. Secret and credential files (.env, keys, .git and the like) are refused.`,
		group: "blob",
		route: ["POST", "/v1/blob/objects"],
		local: true,
		// `overwrite: true` replaces an existing file, so the tool as a whole is destructive.
		annotations: D,
		inputSchema: {
			file: z.string().describe("File on the computer"),
			path: z.string().optional().describe("Path in Blob Storage (default: the file name)"),
			visibility: visibility.optional().describe("Default: private"),
			overwrite: z.boolean().optional().describe("Replace an existing file at this path (default: false)"),
			rename_on_conflict: z.boolean().optional().describe("If the path is taken, save as name-1.ext, name-2.ext, ... and return the final path (default: false; not with overwrite)"),
			workspace_id,
		},
		handler: (args, client) =>
			guardLocal(async () => {
				const file = readLocalFile(String(args.file), MAX_SIMPLE_UPLOAD_BYTES);
				const form = new FormData();
				form.append("file", new Blob([new Uint8Array(file.bytes)]), file.name);
				return respond(
					await client.blobClient().postMultipart("/objects", form, {
						path: str(args.path) ?? file.name,
						visibility: str(args.visibility) ?? "private",
						overwrite: Boolean(args.overwrite),
						rename_on_conflict: args.rename_on_conflict === true ? true : undefined,
						workspace_id: str(args.workspace_id),
					}),
				);
			}),
	},
	{
		name: "delete_blob_object",
		description: "Deletes one file from Blob Storage. Its public URL stops working.",
		group: "blob",
		route: ["DELETE", "/v1/blob/objects/:object_id"],
		annotations: D,
		inputSchema: { id, workspace_id },
		handler: (args, client) =>
			client
				.blobClient()
				.delete(`/objects/${enc(args.id)}`, { workspace_id: str(args.workspace_id) })
				.then((r) => respond(r)),
	},
	{
		name: "blob_download_url",
		description: "Creates a temporary link to download a Blob Storage file, for private files too. The link cannot be revoked; it expires.",
		group: "blob",
		route: ["GET", "/v1/blob/objects/:object_id/download"],
		annotations: R,
		inputSchema: {
			id,
			expires_in: z.number().int().min(60).max(86400).optional().describe("Seconds the link stays valid (60-86400, default 3600)"),
			workspace_id,
		},
		handler: (args, client) =>
			client
				.blobClient()
				.get(`/objects/${enc(args.id)}/download`, {
					expires_in: args.expires_in === undefined ? undefined : Number(args.expires_in),
					redirect: false,
					workspace_id: str(args.workspace_id),
				})
				.then((r) => respond(r)),
	},
	{
		name: "blob_stats",
		description: "Blob Storage usage of the account: files, used and total space, and the limits of the plan.",
		group: "blob",
		route: ["GET", "/v1/blob/stats"],
		annotations: R,
		inputSchema: { workspace_id },
		handler: (args, client) =>
			client
				.blobClient()
				.get("/stats", { workspace_id: str(args.workspace_id) })
				.then((r) => respond(r)),
	},
	{
		name: "set_blob_visibility",
		description: "Changes a Blob Storage file between public and private. Public files get a permanent URL; private ones need a temporary link.",
		group: "blob",
		route: ["PATCH", "/v1/blob/objects/:object_id"],
		annotations: WI,
		inputSchema: { id, visibility, workspace_id },
		handler: (args, client) =>
			client
				.blobClient()
				.patch(`/objects/${enc(args.id)}`, { visibility: String(args.visibility) }, { workspace_id: str(args.workspace_id) })
				.then((r) => respond(r)),
	},
];
