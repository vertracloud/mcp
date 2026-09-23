import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type ClientOptions, VertraClient } from "./client.js";
import { LocalError, setLocalMode } from "./local.js";
import { fail } from "./result.js";
import { type ToolDefinition, toolScope, tools } from "./tools/index.js";

export interface CreateServerOptions extends ClientOptions {
	/**
	 * `true` (stdio on the user's own machine): also registers the tools that read or write disk.
	 * `false` (default): only the ones that talk to the API.
	 */
	local?: boolean;
}

/** Tools that apply to a given transport mode. */
export function toolsFor(local: boolean): ToolDefinition[] {
	return tools.filter((tool) => local || !tool.local);
}

/** An `McpServer` with the Vertra Cloud tools, authenticated with the user's API key. */
export function createServer(apiKey: string, opts: CreateServerOptions = {}): McpServer {
	setLocalMode(opts.local === true);
	const client = new VertraClient(apiKey, opts);
	const server = new McpServer(
		{ name: "vertracloud", version: "0.1.0" }, // x-release-please-version
		{ instructions: "Vertra Cloud tools. Consult `get_docs` before stating any price, limit or supported language." },
	);

	for (const tool of toolsFor(opts.local === true)) {
		const scope = toolScope(tool);
		server.registerTool(
			tool.name,
			{
				description: scope ? `${tool.description} (scope: ${scope})` : tool.description,
				inputSchema: tool.inputSchema,
				annotations: { ...tool.annotations, openWorldHint: true },
			},
			// biome-ignore lint/suspicious/noExplicitAny: the SDK infers the schema type per tool
			(async (args: Record<string, unknown>) => {
				try {
					return await tool.handler(args ?? {}, client);
				} catch (err) {
					if (err instanceof LocalError) return fail({ code: err.code, message: err.message });
					return fail({ code: "TOOL_ERROR", message: err instanceof Error ? err.message : String(err) });
				}
			}) as any,
		);
	}

	return server;
}
