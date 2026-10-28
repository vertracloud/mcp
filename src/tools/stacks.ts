import { respond } from "../result.js";
import { R, type ToolDefinition } from "./defs.js";
import { enc, str } from "./util.js";
import { z } from "zod";

const workspace_id = z.string().optional();

export const stacksTools: ToolDefinition[] = [
	{
		name: "list_stacks",
		description:
			"Lists your stacks: groups of applications, databases and Blob folders that are connected to each other (for example, what a multi-service template creates). Each one has its members, the summed status and RAM, and the template it came from.",
		group: "stacks",
		route: ["GET", "/v1/stacks"],
		annotations: R,
		inputSchema: { workspace_id },
		handler: (args, client) => client.get("/v1/stacks", { workspace_id: str(args.workspace_id) }).then((r) => respond(r)),
	},
	{
		name: "get_stack",
		description:
			"One stack: members, status, total RAM, the connections (bindings, by variable NAME, never values), network mode, template of origin and whether a newer template version is available. To get the code that connects an application to what it is linked to, use `get_connection_info` with `app_id`.",
		group: "stacks",
		route: ["GET", "/v1/stacks/:stack_id"],
		annotations: R,
		inputSchema: { id: z.string().min(1).describe("Stack ID"), workspace_id },
		handler: (args, client) =>
			client.get(`/v1/stacks/${enc(args.id)}`, { workspace_id: str(args.workspace_id) }).then((r) => respond(r)),
	},
];
