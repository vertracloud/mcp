#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const apiKey = process.env.VERTRA_API_KEY;

if (!apiKey) {
	process.stderr.write(
		"vertracloud-mcp: missing the VERTRA_API_KEY environment variable.\n" +
			"Create a key at https://vertracloud.app/dashboard/settings (API keys) and set it\n" +
			'in the "env" field of your MCP client configuration.\n',
	);
	process.exit(1);
}

// `VERTRA_API_URL` only to point at a different environment; normal use leaves it unset.
const server = createServer(apiKey, { local: true, baseUrl: process.env.VERTRA_API_URL });
await server.connect(new StdioServerTransport());
