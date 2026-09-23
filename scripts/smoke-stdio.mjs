/** Boots the compiled server and checks the MCP handshake. `npm run build && node scripts/smoke-stdio.mjs`. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const child = spawn("node", ["dist/stdio.js"], { env: { ...process.env, VERTRA_API_KEY: "smoke" } });
let out = "";
child.stdout.on("data", (chunk) => {
	out += chunk;
});
const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);

send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } });
await new Promise((resolve) => setTimeout(resolve, 300));
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
await new Promise((resolve) => setTimeout(resolve, 900));
child.kill();

const messages = out.trim().split("\n").map((line) => JSON.parse(line));
const init = messages.find((m) => m.id === 1);
const list = messages.find((m) => m.id === 2);
assert.equal(init?.result?.serverInfo?.name, "vertracloud");
const names = list.result.tools.map((tool) => tool.name);
for (const name of ["get_docs", "list_apps", "create_app", "deploy_app"]) assert.ok(names.includes(name), name);
console.log(`handshake ok — ${names.length} tools in local mode.`);
