import { z } from "zod";
import { fail, ok, respond } from "../result.js";
import { D, R, W, WI, type ToolDefinition } from "./defs.js";
import { enc, str } from "./util.js";

const id = z.string().describe("Application ID");
const workspace_id = z.string().optional();

export const networkTools: ToolDefinition[] = [
	{
		name: "get_network",
		description: "The application's custom domain and DNS records, in a single response.",
		group: "network",
		route: ["GET", "/v1/apps/:id/network/custom"],
		annotations: R,
		inputSchema: { id, workspace_id },
		handler: async (args, client) => {
			const query = { workspace_id: str(args.workspace_id) };
			const [custom, dns] = await Promise.all([
				client.get(`/v1/apps/${enc(args.id)}/network/custom`, query),
				client.get(`/v1/apps/${enc(args.id)}/network/dns`, query),
			]);
			if (!custom.ok) return fail(custom.body);
			return ok({ custom: custom.body, dns: dns.ok ? dns.body : null, dns_error: dns.ok ? undefined : dns.body });
		},
	},
	{
		name: "set_subdomain",
		description: "Changes the application's public subdomain. Who is allowed to pick the name is determined by the plan.",
		group: "network",
		route: ["PATCH", "/v1/apps/:id/network/subdomain"],
		annotations: WI,
		inputSchema: { id, subdomain: z.string(), workspace_id },
		handler: (args, client) =>
			client
				.patch(`/v1/apps/${enc(args.id)}/network/subdomain`, { subdomain: String(args.subdomain) }, { workspace_id: str(args.workspace_id) })
				.then((r) => respond(r)),
	},
	{
		name: "publish_app",
		description: "Publishes the application on the web (public subdomain).",
		group: "network",
		route: ["POST", "/v1/apps/:id/network/publish"],
		annotations: WI,
		inputSchema: { id, subdomain: z.string().optional(), workspace_id },
		handler: (args, client) =>
			client
				.post(`/v1/apps/${enc(args.id)}/network/publish`, args.subdomain ? { subdomain: String(args.subdomain) } : {}, { workspace_id: str(args.workspace_id) })
				.then((r) => respond(r)),
	},
	{
		name: "unpublish_app",
		description: "Takes the application off the web; the public address stops responding.",
		group: "network",
		route: ["DELETE", "/v1/apps/:id/network/publish"],
		annotations: D,
		inputSchema: { id, workspace_id },
		handler: (args, client) =>
			client.delete(`/v1/apps/${enc(args.id)}/network/publish`, { workspace_id: str(args.workspace_id) }).then((r) => respond(r)),
	},
	{
		name: "set_custom_domain",
		description: "Points a custom domain to the application.",
		group: "network",
		route: ["POST", "/v1/apps/:id/network/custom"],
		annotations: WI,
		inputSchema: { id, domain: z.string(), workspace_id },
		handler: (args, client) =>
			client
				.post(`/v1/apps/${enc(args.id)}/network/custom`, { domain: String(args.domain) }, { workspace_id: str(args.workspace_id) })
				.then((r) => respond(r)),
	},
	{
		name: "remove_custom_domain",
		description: "Removes the application's custom domain; whoever accessed it through that domain stops reaching it.",
		group: "network",
		route: ["DELETE", "/v1/apps/:id/network/custom"],
		annotations: D,
		inputSchema: { id, workspace_id },
		handler: (args, client) =>
			client.delete(`/v1/apps/${enc(args.id)}/network/custom`, { workspace_id: str(args.workspace_id) }).then((r) => respond(r)),
	},
	{
		name: "purge_cache",
		description: "Clears the application's edge cache.",
		group: "network",
		route: ["POST", "/v1/apps/:id/network/purge-cache"],
		annotations: W,
		inputSchema: {
			id,
			hostnames: z.array(z.string()).optional(),
			paths: z.array(z.string()).optional(),
			workspace_id,
		},
		handler: (args, client) =>
			client
				.post(`/v1/apps/${enc(args.id)}/network/purge-cache`, { hostnames: args.hostnames, paths: args.paths }, { workspace_id: str(args.workspace_id) })
				.then((r) => respond(r)),
	},
];
