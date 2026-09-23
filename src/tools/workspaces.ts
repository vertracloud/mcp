import { z } from "zod";
import { respond } from "../result.js";
import { D, R, W, WI, type ToolDefinition } from "./defs.js";
import { enc, pick } from "./util.js";

const id = z.string().describe("Workspace ID");
const token = z.string().describe("Invite token (the final part of the link)");

export const workspacesTools: ToolDefinition[] = [
	{
		name: "list_workspaces",
		description: "Workspaces the account is a member of.",
		group: "workspaces",
		route: ["GET", "/v1/workspaces"],
		annotations: R,
		inputSchema: {},
		handler: (_args, client) => client.get("/v1/workspaces").then((r) => respond(r)),
	},
	{
		name: "get_workspace",
		description: "Details of a workspace.",
		group: "workspaces",
		route: ["GET", "/v1/workspaces/:id"],
		annotations: R,
		inputSchema: { id },
		handler: (args, client) => client.get(`/v1/workspaces/${enc(args.id)}`).then((r) => respond(r)),
	},
	{
		name: "create_workspace",
		description: "Creates a workspace.",
		group: "workspaces",
		route: ["POST", "/v1/workspaces"],
		annotations: W,
		inputSchema: { name: z.string(), description: z.string().optional() },
		handler: (args, client) => client.post("/v1/workspaces", pick(args, ["name", "description"])).then((r) => respond(r)),
	},
	{
		name: "update_workspace",
		description: "Changes the workspace's name or description.",
		group: "workspaces",
		route: ["PUT", "/v1/workspaces/:id"],
		annotations: WI,
		inputSchema: { id, name: z.string().optional(), description: z.string().optional() },
		handler: (args, client) =>
			client.put(`/v1/workspaces/${enc(args.id)}`, pick(args, ["name", "description"])).then((r) => respond(r)),
	},
	{
		name: "add_app_to_workspace",
		description: "Moves an application into the workspace.",
		group: "workspaces",
		route: ["POST", "/v1/workspaces/:id/apps/:app_id"],
		annotations: WI,
		inputSchema: { id, app_id: z.string() },
		handler: (args, client) => client.post(`/v1/workspaces/${enc(args.id)}/apps/${enc(args.app_id)}`).then((r) => respond(r)),
	},
	{
		name: "remove_app_from_workspace",
		description: "Takes an application out of the workspace and returns it to the owning account.",
		group: "workspaces",
		route: ["DELETE", "/v1/workspaces/:id/apps/:app_id"],
		annotations: WI,
		inputSchema: { id, app_id: z.string() },
		handler: (args, client) => client.delete(`/v1/workspaces/${enc(args.id)}/apps/${enc(args.app_id)}`).then((r) => respond(r)),
	},
	{
		name: "add_database_to_workspace",
		description: "Moves a database into the workspace.",
		group: "workspaces",
		route: ["POST", "/v1/workspaces/:id/databases/:db_id"],
		annotations: WI,
		inputSchema: { id, database_id: z.string() },
		handler: (args, client) =>
			client.post(`/v1/workspaces/${enc(args.id)}/databases/${enc(args.database_id)}`).then((r) => respond(r)),
	},
	{
		name: "remove_database_from_workspace",
		description: "Takes a database out of the workspace and returns it to the owning account.",
		group: "workspaces",
		route: ["DELETE", "/v1/workspaces/:id/databases/:db_id"],
		annotations: WI,
		inputSchema: { id, database_id: z.string() },
		handler: (args, client) =>
			client.delete(`/v1/workspaces/${enc(args.id)}/databases/${enc(args.database_id)}`).then((r) => respond(r)),
	},
	{
		name: "list_members",
		description: "The workspace's members and each one's role.",
		group: "workspaces",
		route: ["GET", "/v1/workspaces/:id/members"],
		annotations: R,
		inputSchema: { id },
		handler: (args, client) => client.get(`/v1/workspaces/${enc(args.id)}/members`).then((r) => respond(r)),
	},
	{
		name: "update_member",
		description: "Changes a workspace member's role.",
		group: "workspaces",
		route: ["PUT", "/v1/workspaces/:id/members/:user_id"],
		annotations: WI,
		inputSchema: { id, user_id: z.string(), role_id: z.string() },
		handler: (args, client) =>
			client.put(`/v1/workspaces/${enc(args.id)}/members/${enc(args.user_id)}`, { role_id: String(args.role_id) }).then((r) => respond(r)),
	},
	{
		name: "remove_member",
		description: "Removes a member from the workspace; they lose access immediately.",
		group: "workspaces",
		route: ["DELETE", "/v1/workspaces/:id/members/:user_id"],
		annotations: D,
		inputSchema: { id, user_id: z.string() },
		handler: (args, client) => client.delete(`/v1/workspaces/${enc(args.id)}/members/${enc(args.user_id)}`).then((r) => respond(r)),
	},
	{
		name: "list_roles",
		description: "The workspace's roles and each one's permissions.",
		group: "workspaces",
		route: ["GET", "/v1/workspaces/:id/roles"],
		annotations: R,
		inputSchema: { id },
		handler: (args, client) => client.get(`/v1/workspaces/${enc(args.id)}/roles`).then((r) => respond(r)),
	},
	{
		name: "create_role",
		description: "Creates a role in the workspace.",
		group: "workspaces",
		route: ["POST", "/v1/workspaces/:id/roles"],
		annotations: W,
		inputSchema: {
			id,
			name: z.string(),
			permissions: z.array(z.string()),
			position: z.number().int().optional(),
		},
		handler: (args, client) =>
			client
				.post(`/v1/workspaces/${enc(args.id)}/roles`, pick(args, ["name", "permissions", "position"]))
				.then((r) => respond(r)),
	},
	{
		name: "update_role",
		description: "Changes a workspace role's name or permissions.",
		group: "workspaces",
		route: ["PUT", "/v1/workspaces/:id/roles/:role_id"],
		annotations: WI,
		inputSchema: {
			id,
			role_id: z.string(),
			name: z.string(),
			permissions: z.array(z.string()),
			position: z.number().int().optional(),
		},
		handler: (args, client) =>
			client
				.put(`/v1/workspaces/${enc(args.id)}/roles/${enc(args.role_id)}`, pick(args, ["name", "permissions", "position"]))
				.then((r) => respond(r)),
	},
	{
		name: "delete_role",
		description: "Deletes a role from the workspace; whoever had it loses those permissions.",
		group: "workspaces",
		route: ["DELETE", "/v1/workspaces/:id/roles/:role_id"],
		annotations: D,
		inputSchema: { id, role_id: z.string() },
		handler: (args, client) => client.delete(`/v1/workspaces/${enc(args.id)}/roles/${enc(args.role_id)}`).then((r) => respond(r)),
	},
	{
		name: "delete_workspace",
		description:
			"Deletes the workspace (owner only). Members, roles, invites and links disappear; apps and databases go back to the owning account. This cannot be undone.",
		group: "workspaces",
		route: ["DELETE", "/v1/workspaces/:id"],
		annotations: D,
		inputSchema: { id },
		handler: (args, client) => client.delete(`/v1/workspaces/${enc(args.id)}`).then((r) => respond(r)),
	},
	{
		name: "list_workspace_invites",
		description: "The workspace's invites (pending and past). Creating an invite is dashboard-only.",
		group: "workspaces",
		route: ["GET", "/v1/workspaces/:id/invites"],
		annotations: R,
		inputSchema: { id },
		handler: (args, client) => client.get(`/v1/workspaces/${enc(args.id)}/invites`).then((r) => respond(r)),
	},
	{
		name: "revoke_workspace_invite",
		description: "Revokes a pending workspace invite; the link or email stops working.",
		group: "workspaces",
		route: ["DELETE", "/v1/workspaces/:id/invites/:invite_id"],
		annotations: D,
		inputSchema: { id, invite_id: z.string() },
		handler: (args, client) =>
			client.delete(`/v1/workspaces/${enc(args.id)}/invites/${enc(args.invite_id)}`).then((r) => respond(r)),
	},
	{
		name: "preview_workspace_invite",
		description: "Shows which workspace and role an invite leads to, before accepting it.",
		group: "workspaces",
		route: ["GET", "/v1/workspaces/invites/:token"],
		annotations: R,
		inputSchema: { token },
		handler: (args, client) => client.get(`/v1/workspaces/invites/${enc(args.token)}`).then((r) => respond(r)),
	},
	{
		name: "accept_workspace_invite",
		description:
			"Accepts an invite and joins the workspace with the account that owns the key. An invite sent by email only works for that account's email.",
		group: "workspaces",
		route: ["POST", "/v1/workspaces/invites/:token/accept"],
		annotations: WI,
		inputSchema: { token },
		handler: (args, client) => client.post(`/v1/workspaces/invites/${enc(args.token)}/accept`).then((r) => respond(r)),
	},
	{
		name: "decline_workspace_invite",
		description: "Declines an invite without joining the workspace; the invite stops being valid.",
		group: "workspaces",
		route: ["POST", "/v1/workspaces/invites/:token/decline"],
		annotations: D,
		inputSchema: { token },
		handler: (args, client) => client.post(`/v1/workspaces/invites/${enc(args.token)}/decline`).then((r) => respond(r)),
	},
	{
		name: "list_action_requests",
		description:
			"The workspace's action requests (delete app/database, create/restore snapshot). Approving or rejecting is dashboard-only.",
		group: "workspaces",
		route: ["GET", "/v1/workspaces/:id/action-requests"],
		annotations: R,
		inputSchema: { id, status: z.enum(["pending", "approved", "rejected", "expired"]).optional() },
		handler: (args, client) =>
			client
				.get(`/v1/workspaces/${enc(args.id)}/action-requests`, args.status ? { status: String(args.status) } : undefined)
				.then((r) => respond(r)),
	},
	{
		name: "create_action_request",
		description:
			"Asks whoever has the permission to carry out an action the account can't do on its own. Nothing runs until a person approves it in the dashboard.",
		group: "workspaces",
		route: ["POST", "/v1/workspaces/:id/action-requests"],
		annotations: W,
		inputSchema: {
			id,
			action: z.enum(["app_delete", "database_delete", "snapshot_create", "snapshot_restore"]),
			resource_id: z.string().describe("Application or database ID"),
			snapshot_id: z.string().optional().describe("Required for snapshot_restore"),
		},
		handler: (args, client) =>
			client
				.post(`/v1/workspaces/${enc(args.id)}/action-requests`, {
					action: args.action,
					resource_id: args.resource_id,
					...(args.snapshot_id ? { params: { snapshot_id: args.snapshot_id } } : {}),
				})
				.then((r) => respond(r)),
	},
];
