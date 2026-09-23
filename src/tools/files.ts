import { z } from "zod";
import { zipFiles } from "../local.js";
import { respond } from "../result.js";
import { D, R, W, WI, type ToolDefinition } from "./defs.js";
import { enc, guardLocal, str } from "./util.js";

const id = z.string().describe("Application ID");
const workspace_id = z.string().optional();

/** Decodes to text when the content is UTF-8 with no null byte; otherwise returns base64. */
export function decodeFileContent(body: unknown): unknown {
	const res = (body ?? {}) as { type?: string; data?: unknown; size?: number; last_modified?: string };
	if (res.type !== "base64" || typeof res.data !== "string") return body;
	const bytes = Buffer.from(res.data, "base64");

	const meta = { size: res.size ?? bytes.length, last_modified: res.last_modified };
	if (!bytes.includes(0)) {
		const text = bytes.toString("utf8");
		if (!text.includes("�")) return { ...meta, encoding: "utf-8", content: text };
	}
	return { ...meta, encoding: "base64", content: bytes.toString("base64") };
}

export const filesTools: ToolDefinition[] = [
	{
		name: "list_files",
		description: "Lists the files and folders of a directory in the application.",
		group: "files",
		route: ["GET", "/v1/apps/:id/files"],
		annotations: R,
		inputSchema: { id, path: z.string().optional().describe("Path inside the application (default: root)"), workspace_id },
		handler: (args, client) =>
			client
				.get(`/v1/apps/${enc(args.id)}/files`, { path: str(args.path), workspace_id: str(args.workspace_id) })
				.then((r) => respond(r)),
	},
	{
		name: "get_file_tree",
		description: "The application's full file tree.",
		group: "files",
		route: ["GET", "/v1/apps/:id/files/tree"],
		annotations: R,
		inputSchema: { id, workspace_id },
		handler: (args, client) =>
			client.get(`/v1/apps/${enc(args.id)}/files/tree`, { workspace_id: str(args.workspace_id) }).then((r) => respond(r)),
	},
	{
		name: "read_file",
		description: 'Reads a file from the application. Text comes back readable; binary comes back as base64 with `encoding: "base64"`.',
		group: "files",
		route: ["GET", "/v1/apps/:id/files/content"],
		annotations: R,
		inputSchema: { id, path: z.string().describe("Path of the file inside the application"), workspace_id },
		handler: async (args, client) => {
			const res = await client.get(`/v1/apps/${enc(args.id)}/files/content`, {
				path: String(args.path),
				workspace_id: str(args.workspace_id),
			});
			return respond(res, decodeFileContent);
		},
	},
	{
		name: "write_file",
		description: "Writes text content to a file in the application, creating it if it doesn't exist.",
		group: "files",
		route: ["PUT", "/v1/apps/:id/files"],
		annotations: WI,
		inputSchema: { id, path: z.string(), content: z.string(), workspace_id },
		handler: (args, client) =>
			client
				.put(`/v1/apps/${enc(args.id)}/files`, { path: String(args.path), content: String(args.content) }, { workspace_id: str(args.workspace_id) })
				.then((r) => respond(r)),
	},
	{
		name: "move_file",
		description: "Moves or renames a file inside the application.",
		group: "files",
		route: ["PATCH", "/v1/apps/:id/files"],
		annotations: W,
		inputSchema: { id, from: z.string().describe("Current path"), to: z.string().describe("New path"), workspace_id },
		handler: (args, client) =>
			client
				.patch(`/v1/apps/${enc(args.id)}/files`, { path: String(args.from), to: String(args.to) }, { workspace_id: str(args.workspace_id) })
				.then((r) => respond(r)),
	},
	{
		name: "upload_files",
		description: "Uploads files from the computer to a folder in the application.",
		group: "files",
		route: ["POST", "/v1/apps/:id/files/upload"],
		local: true,
		annotations: W,
		inputSchema: {
			id,
			paths: z.array(z.string()).min(1).describe("Files on the computer"),
			dest: z.string().optional().describe("Destination folder inside the application (default: root)"),
			restart: z.boolean().optional().describe("Restart after upload (default: false)"),
			workspace_id,
		},
		handler: (args, client) =>
			guardLocal(async () => {
				const zip = zipFiles((args.paths as string[]).map(String), str(args.dest) ?? "");
				const form = new FormData();
				form.append("file", new Blob([new Uint8Array(zip)]), "upload.zip");
				return respond(
					await client.postMultipart(`/v1/apps/${enc(args.id)}/files/upload`, form, {
						restart: String(Boolean(args.restart)),
						workspace_id: str(args.workspace_id),
					}),
				);
			}),
	},
	{
		name: "delete_file",
		description: "Deletes a file or folder from the application.",
		group: "files",
		route: ["DELETE", "/v1/apps/:id/files"],
		annotations: D,
		inputSchema: { id, path: z.string(), workspace_id },
		handler: (args, client) =>
			client
				.delete(`/v1/apps/${enc(args.id)}/files`, { path: String(args.path), workspace_id: str(args.workspace_id) })
				.then((r) => respond(r)),
	},
];
