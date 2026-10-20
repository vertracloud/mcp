import { z } from "zod";
import { fail, ok, respond } from "../result.js";
import { D, DI, R, W, WI, type ToolDefinition } from "./defs.js";
import { enc, pick, str } from "./util.js";

const id = z.string().min(1).describe("Application ID");
const workspace_id = z.string().optional();
const domain_id = z.string().min(1).describe("Domain ID (from `list_domains`)");
const port = z.number().int().min(1).max(65535).describe("Application port that serves the domain, 1-65535 (default 80)");
const pathPrefix = z
	.string()
	.max(128)
	.regex(/^(\/[A-Za-z0-9._~-]+)+$/, "must be segments of letters, numbers, \".\", \"_\", \"~\" and \"-\", each starting with \"/\", no trailing \"/\"")
	.refine((value) => !value.split("/").some((segment) => segment === "." || segment === ".."), "must not contain \".\" or \"..\" segments")
	.describe("Literal path added in front of every request, e.g. `/api`");
const redirectStatus = z
	.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)])
	.describe("Redirect status code (default 308); only applies with `redirect_to`");

export const networkTools: ToolDefinition[] = [
	{
		name: "get_network",
		description: "The application's custom domains: hostname, status, SSL status, port, path prefix and redirect. For the DNS records of one domain, use `get_domain_dns`.",
		group: "network",
		route: ["GET", "/v1/apps/:id/domains"],
		annotations: R,
		inputSchema: { id, workspace_id },
		handler: async (args, client) => {
			const domains = await client.get(`/v1/apps/${enc(args.id)}/domains`, { workspace_id: str(args.workspace_id) });
			if (!domains.ok) return fail(domains.body);
			return ok({ domains: domains.body });
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
		description: "Takes the application off the web; the public address stops responding. Also permanently removes all of the application's custom domains: publishing again brings back only the subdomain, and adding a domain again requires new DNS validation.",
		group: "network",
		route: ["DELETE", "/v1/apps/:id/network/publish"],
		annotations: D,
		inputSchema: { id, workspace_id },
		handler: (args, client) =>
			client.delete(`/v1/apps/${enc(args.id)}/network/publish`, { workspace_id: str(args.workspace_id) }).then((r) => respond(r)),
	},
	{
		name: "list_domains",
		description: "Lists the application's custom domains: hostname, status, SSL status, port, path prefix and redirect.",
		group: "network",
		route: ["GET", "/v1/apps/:id/domains"],
		annotations: R,
		inputSchema: { id, workspace_id },
		handler: (args, client) => client.get(`/v1/apps/${enc(args.id)}/domains`, { workspace_id: str(args.workspace_id) }).then((r) => respond(r)),
	},
	{
		name: "add_domain",
		description:
			"Adds a custom domain to the application, with no redeploy. By default it also creates the automatic `www` (or root) companion, which does not count toward the plan's domain limit. Then call `get_domain_dns` for the records to create at the DNS provider. `port` (1-65535, default 80) is the application port that serves the domain; `path_prefix` is a literal path added in front of every request; `redirect_to` is the id of another domain of the same application, and then the domain redirects there with `redirect_status`. Possible errors: PLAN_DOES_NOT_SUPPORT_CUSTOM_DOMAIN, DOMAIN_LIMIT_REACHED, DOMAIN_PORT_LIMIT_REACHED, DOMAIN_ALREADY_IN_USE, INVALID_CUSTOM_DOMAIN_FORMAT, INVALID_DOMAIN_PORT, INVALID_PATH_PREFIX, INVALID_REDIRECT_TARGET.",
		group: "network",
		route: ["POST", "/v1/apps/:id/domains"],
		annotations: W,
		inputSchema: {
			id,
			hostname: z.string().describe("Domain name, e.g. `my-app.com.br`"),
			www: z.boolean().optional().describe("Also create the automatic www/root companion (default true)"),
			port: port.optional(),
			path_prefix: pathPrefix.optional(),
			redirect_to: z.string().optional().describe("Id of another domain of the same application to redirect to"),
			redirect_status: redirectStatus.optional(),
			workspace_id,
		},
		handler: (args, client) =>
			client
				.post(
					`/v1/apps/${enc(args.id)}/domains`,
					pick(args, ["hostname", "www", "port", "path_prefix", "redirect_to", "redirect_status"]),
					{ workspace_id: str(args.workspace_id) },
				)
				.then((r) => respond(r)),
	},
	{
		name: "update_domain",
		description:
			"Changes a custom domain without redeploying. Send only what changes; `null` clears `path_prefix` or `redirect_to`. `primary: true` swaps the domain with its automatic companion as the main one. Returns the changed domains. Changes where real traffic goes (port, path prefix, redirect), so it takes effect immediately.",
		group: "network",
		route: ["PATCH", "/v1/apps/:id/domains/:domain_id"],
		annotations: DI,
		inputSchema: {
			id,
			domain_id,
			port: port.optional(),
			path_prefix: pathPrefix.nullable().optional(),
			redirect_to: z.string().nullable().optional().describe("Id of another domain of the same application, or null to serve the application"),
			redirect_status: redirectStatus.optional(),
			primary: z.literal(true).optional().describe("Make this domain the main one instead of its companion"),
			workspace_id,
		},
		handler: (args, client) =>
			client
				.patch(
					`/v1/apps/${enc(args.id)}/domains/${enc(args.domain_id)}`,
					pick(args, ["port", "path_prefix", "redirect_to", "redirect_status", "primary"]),
					{ workspace_id: str(args.workspace_id) },
				)
				.then((r) => respond(r)),
	},
	{
		name: "remove_domain",
		description: "Removes a custom domain and its automatic companion; whoever accessed the application through them stops reaching it.",
		group: "network",
		route: ["DELETE", "/v1/apps/:id/domains/:domain_id"],
		annotations: D,
		inputSchema: { id, domain_id, workspace_id },
		handler: (args, client) =>
			client
				.delete(`/v1/apps/${enc(args.id)}/domains/${enc(args.domain_id)}`, { workspace_id: str(args.workspace_id) })
				.then((r) => respond(r)),
	},
	{
		name: "get_domain_dns",
		description: "DNS records the user must create at the DNS provider for a custom domain, with the status of each (pending or active).",
		group: "network",
		route: ["GET", "/v1/apps/:id/domains/:domain_id/dns"],
		annotations: R,
		inputSchema: { id, domain_id, workspace_id },
		handler: (args, client) =>
			client
				.get(`/v1/apps/${enc(args.id)}/domains/${enc(args.domain_id)}/dns`, { workspace_id: str(args.workspace_id) })
				.then((r) => respond(r)),
	},
	{
		name: "get_domain_connect_url",
		description: "Returns a link that configures the domain's DNS automatically at a supported DNS provider, for the user to open. Fails with DOMAIN_CONNECT_UNAVAILABLE (404) when automatic setup is not available; then use `get_domain_dns`.",
		group: "network",
		route: ["POST", "/v1/apps/:id/domains/:domain_id/connect"],
		annotations: WI,
		inputSchema: { id, domain_id, workspace_id },
		handler: (args, client) =>
			client
				.post(`/v1/apps/${enc(args.id)}/domains/${enc(args.domain_id)}/connect`, {}, { workspace_id: str(args.workspace_id) })
				.then((r) => respond(r)),
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
