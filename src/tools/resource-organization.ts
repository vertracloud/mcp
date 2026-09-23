import { z, type ZodRawShape, type ZodTypeAny } from "zod";
import { WORKSPACE_FOLDER_COLORS, WorkspaceResourceType } from "@vertracloud/api-types/v1";
import { respond } from "../result.js";
import { D, W, WI, type ToolDefinition } from "./defs.js";
import { enc, pick } from "./util.js";

const resourceType = z.enum([WorkspaceResourceType.Application, WorkspaceResourceType.Database]);
const folderColor = z.enum(WORKSPACE_FOLDER_COLORS as [string, ...string[]]);

const createFolder = z
	.object({
		name: z.string().trim().min(1).max(80),
		color: folderColor.optional(),
		position: z.number().int().nonnegative().max(9999).optional(),
	})
	.strict();

const updateFolderShape = {
	name: z.string().trim().min(1).max(80).optional(),
	color: folderColor.optional(),
	position: z.number().int().nonnegative().max(9999).optional(),
};

const resource = z
	.object({
		resource_type: resourceType,
		resource_id: z.string().min(1),
		position: z.number().int().nonnegative().max(9999).optional(),
	})
	.strict();

const id = z.string().min(1);

type OrganizationScope = "personal" | "workspace";

function base(scope: OrganizationScope, args: Record<string, unknown>): string {
	return scope === "personal"
		? "/v1/users/me"
		: `/v1/workspaces/${enc(args.workspace_id)}`;
}

function folderRoute(scope: OrganizationScope, method: "POST" | "PATCH" | "DELETE"): ["POST" | "PATCH" | "DELETE", string] {
	const prefix = scope === "personal" ? "/v1/users/me" : "/v1/workspaces/:id";
	return [method, `${prefix}/folders`];
}

function folderItemRoute(scope: OrganizationScope, method: "PUT" | "DELETE"): ["PUT" | "DELETE", string] {
	const prefix = scope === "personal" ? "/v1/users/me" : "/v1/workspaces/:id";
	return [method, `${prefix}/folders/:folder_id/resources/:resource_type/:resource_id`];
}

function favoriteRoute(scope: OrganizationScope, method: "PUT" | "DELETE"): ["PUT" | "DELETE", string] {
	const prefix = scope === "personal" ? "/v1/users/me" : "/v1/workspaces/:id";
	return [method, `${prefix}/favorites/:resource_type/:resource_id`];
}

function scopeInput(scope: OrganizationScope, shape: ZodRawShape): z.ZodObject<ZodRawShape> {
	return z
		.object(scope === "personal" ? shape : { workspace_id: id.describe("Workspace ID"), ...shape })
		.strict();
}

function updateInput(scope: OrganizationScope, folderId: ZodTypeAny): ZodTypeAny {
	return scopeInput(scope, { folder_id: folderId, ...updateFolderShape }).refine(
		(value) => Object.keys(value).some((key) => key !== "folder_id" && key !== "workspace_id"),
		"At least one field must be provided.",
	);
}

function createTools(scope: OrganizationScope): ToolDefinition[] {
	const personal = scope === "personal";
	const label = personal ? "personal" : "workspace";
	const group = personal ? "account" : "workspaces";
	const folderId = id.describe("Folder ID");
	const resourceShape = {
		resource_type: resource.shape.resource_type,
		resource_id: resource.shape.resource_id,
	};
	const positionedResourceShape = { ...resourceShape, position: resource.shape.position };

	return [
		{
			name: `create_${personal ? "personal" : "workspace"}_folder`,
			description: `Creates a ${label} folder to organize applications and databases.`,
			group,
			route: folderRoute(scope, "POST"),
			annotations: W,
			inputSchema: scopeInput(scope, { ...createFolder.shape }),
			handler: (args, client) => client.post(`${base(scope, args)}/folders`, pick(args, ["name", "color", "position"])).then((r) => respond(r)),
		},
		{
			name: `update_${personal ? "personal" : "workspace"}_folder`,
			description: `Renames, recolors or reorders a ${label} folder.`,
			group,
			route: [
				"PATCH",
				`${scope === "personal" ? "/v1/users/me" : "/v1/workspaces/:id"}/folders/:folder_id`,
			],
			annotations: WI,
			inputSchema: updateInput(scope, folderId),
			handler: (args, client) =>
				client
					.patch(`${base(scope, args)}/folders/${enc(args.folder_id)}`, pick(args, ["name", "color", "position"]))
					.then((r) => respond(r)),
		},
		{
			name: `delete_${personal ? "personal" : "workspace"}_folder`,
			description: `Deletes a ${label} folder; the resources inside it are not deleted.`,
			group,
			route: [
				"DELETE",
				`${scope === "personal" ? "/v1/users/me" : "/v1/workspaces/:id"}/folders/:folder_id`,
			],
			annotations: D,
			inputSchema: scopeInput(scope, { folder_id: folderId }),
			handler: (args, client) => client.delete(`${base(scope, args)}/folders/${enc(args.folder_id)}`).then((r) => respond(r)),
		},
		{
			name: `add_${personal ? "personal" : "workspace"}_resource_to_folder`,
			description: `Puts an application or database into a ${label} folder.`,
			group,
			route: folderItemRoute(scope, "PUT"),
			annotations: WI,
			inputSchema: scopeInput(scope, { folder_id: folderId, ...positionedResourceShape }),
			handler: (args, client) =>
				client
					.put(
						`${base(scope, args)}/folders/${enc(args.folder_id)}/resources/${enc(args.resource_type)}/${enc(args.resource_id)}`,
						pick(args, ["position"]),
					)
					.then((r) => respond(r)),
		},
		{
			name: `remove_${personal ? "personal" : "workspace"}_resource_from_folder`,
			description: `Removes an application or database from a ${label} folder, without deleting the resource.`,
			group,
			route: folderItemRoute(scope, "DELETE"),
			annotations: WI,
			inputSchema: scopeInput(scope, { folder_id: folderId, ...resourceShape }),
			handler: (args, client) =>
				client
					.delete(
						`${base(scope, args)}/folders/${enc(args.folder_id)}/resources/${enc(args.resource_type)}/${enc(args.resource_id)}`,
					)
					.then((r) => respond(r)),
		},
		{
			name: `favorite_${personal ? "personal" : "workspace"}_resource`,
			description: `Adds an application or database to the ${label} favorites.`,
			group,
			route: favoriteRoute(scope, "PUT"),
			annotations: WI,
			inputSchema: scopeInput(scope, { ...positionedResourceShape }),
			handler: (args, client) =>
				client
					.put(`${base(scope, args)}/favorites/${enc(args.resource_type)}/${enc(args.resource_id)}`, pick(args, ["position"]))
					.then((r) => respond(r)),
		},
		{
			name: `unfavorite_${personal ? "personal" : "workspace"}_resource`,
			description: `Removes an application or database from the ${label} favorites.`,
			group,
			route: favoriteRoute(scope, "DELETE"),
			annotations: WI,
			inputSchema: scopeInput(scope, { ...resourceShape }),
			handler: (args, client) =>
				client.delete(`${base(scope, args)}/favorites/${enc(args.resource_type)}/${enc(args.resource_id)}`).then((r) => respond(r)),
		},
	];
}

export const resourceOrganizationTools: ToolDefinition[] = [...createTools("personal"), ...createTools("workspace")];
