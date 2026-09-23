import type { RESTPostAPIApplicationWebhookCreateBody } from "@vertracloud/api-types/v1";
import { z } from "zod";
import { respond } from "../result.js";
import { D, R, W, type ToolDefinition } from "./defs.js";
import { enc, str } from "./util.js";

const id = z.string().describe("Application ID");
const workspace_id = z.string().optional();

export const deploysTools: ToolDefinition[] = [
	{
		name: "list_deploys",
		description: "The application's deploy history.",
		group: "deploys",
		route: ["GET", "/v1/apps/:id/deploys"],
		annotations: R,
		inputSchema: { id, workspace_id },
		handler: (args, client) =>
			client.get(`/v1/apps/${enc(args.id)}/deploys`, { workspace_id: str(args.workspace_id) }).then((r) => respond(r)),
	},
	{
		name: "get_deploy_webhook",
		description: "The application's automatic-deploy webhook URL.",
		group: "deploys",
		route: ["GET", "/v1/apps/:id/deploys/webhook"],
		annotations: R,
		inputSchema: { id, workspace_id },
		handler: (args, client) =>
			client.get(`/v1/apps/${enc(args.id)}/deploys/webhook`, { workspace_id: str(args.workspace_id) }).then((r) => respond(r)),
	},
	{
		name: "create_deploy_webhook",
		description: "Creates (or renews) the application's automatic-deploy webhook, from an already connected GitHub repository.",
		group: "deploys",
		route: ["POST", "/v1/apps/:id/deploys/webhook"],
		annotations: W,
		inputSchema: {
			id,
			owner: z.string().describe("Login of the repository owner on GitHub"),
			repo_name: z.string().describe("Repository name"),
			repo_id: z.string().describe("Numeric ID of the repository on GitHub"),
			account_id: z.string().describe("Numeric ID of the GitHub App installation/account"),
			workspace_id,
		},
		handler: (args, client) => {
			const body: RESTPostAPIApplicationWebhookCreateBody = {
				owner: String(args.owner),
				repo_name: String(args.repo_name),
				repo_id: String(args.repo_id),
				account_id: String(args.account_id),
			};
			return client
				.post(`/v1/apps/${enc(args.id)}/deploys/webhook`, body, { workspace_id: str(args.workspace_id) })
				.then((r) => respond(r));
		},
	},
	{
		name: "delete_deploy_webhook",
		description: "Removes the automatic-deploy webhook; whoever was using the URL stops being able to deploy.",
		group: "deploys",
		route: ["DELETE", "/v1/apps/:id/deploys/webhook"],
		annotations: D,
		inputSchema: { id, workspace_id },
		handler: (args, client) =>
			client
				.delete(`/v1/apps/${enc(args.id)}/deploys/webhook`, { workspace_id: str(args.workspace_id) })
				.then((r) => respond(r)),
	},
];
