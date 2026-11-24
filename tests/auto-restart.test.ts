import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "vitest";
import { z } from "zod";
import { VertraClient } from "../src/client.js";
import { tools } from "../src/tools/index.js";
import { stubFetch } from "./helpers.js";

const tool = (name: string) => {
	const found = tools.find((t) => t.name === name);
	assert.ok(found, `tool ${name} não existe`);
	return found;
};

let root: string;
const previousRoot = process.env.VERTRA_MCP_ROOT;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "vertra-mcp-"));
	process.env.VERTRA_MCP_ROOT = root;
});

afterEach(() => {
	process.env.VERTRA_MCP_ROOT = previousRoot ?? "";
});

test("update_app_config manda auto_restart no topo do corpo", async () => {
	const { fetch, calls } = stubFetch({ body: { response: "success" } });
	await tool("update_app_config").handler({ id: "a1", auto_restart: false }, new VertraClient("k", { fetch }));
	assert.equal(calls[0]?.method, "PATCH");
	assert.deepEqual(JSON.parse(String(calls[0]?.body)), { auto_restart: false });
});

test("update_app_config, create_app e create_app_from_image aceitam só booleano em auto_restart", () => {
	const bases: Record<string, Record<string, unknown>> = {
		update_app_config: { id: "a1" },
		create_app: { name: "n", snapshot_id: "s" },
		create_app_from_image: { image_id: "i1", name: "n", memory: 256, web: false },
	};
	for (const [name, base] of Object.entries(bases)) {
		const schema = z.object(tool(name).inputSchema as z.ZodRawShape);
		assert.equal(schema.safeParse({ ...base, auto_restart: "off" }).success, false, name);
		assert.equal(schema.safeParse({ ...base, auto_restart: true }).success, true, name);
	}
});

test("create_app manda auto_restart como parte de texto e omite quando não informado", async () => {
	const sent = async (extra: Record<string, unknown>) => {
		const { fetch, calls } = stubFetch({ status: 202, body: { response: { id: "a1" } } });
		await tool("create_app").handler({ name: "n", snapshot_id: "snap-1", ...extra }, new VertraClient("k", { fetch }));
		return calls[0]?.body as FormData;
	};
	assert.equal((await sent({ auto_restart: false })).get("auto_restart"), "false");
	assert.equal((await sent({ auto_restart: true })).get("auto_restart"), "true");
	assert.equal((await sent({})).has("auto_restart"), false);
});

test("create_app com pasta envia o zip e auto_restart no mesmo multipart", async () => {
	const project = join(root, "project");
	mkdirSync(project);
	writeFileSync(join(project, "index.js"), "console.log(1)");
	const sent = async (extra: Record<string, unknown>) => {
		const { fetch, calls } = stubFetch({ status: 202, body: { response: { id: "a1" } } });
		await tool("create_app").handler({ name: "n", path: project, memory: 256, main: "index.js", ...extra }, new VertraClient("k", { fetch }));
		return calls[0]?.body as FormData;
	};
	const withFlag = await sent({ auto_restart: false });
	assert.ok(withFlag.get("file") instanceof Blob);
	assert.equal(withFlag.get("memory"), "256");
	assert.equal(withFlag.get("main"), "index.js");
	assert.equal(withFlag.get("auto_restart"), "false");
	assert.equal((await sent({})).has("auto_restart"), false);
});

test("create_app_from_image repassa auto_restart no corpo e omite quando não informado", async () => {
	const sent = async (extra: Record<string, unknown>) => {
		const { fetch, calls } = stubFetch({ status: 202, body: { response: { id: "a1" } } });
		await tool("create_app_from_image").handler(
			{ image_id: "i1", name: "n", memory: 256, web: false, ...extra },
			new VertraClient("k", { fetch }),
		);
		return JSON.parse(String(calls[0]?.body)) as Record<string, unknown>;
	};
	assert.equal((await sent({ auto_restart: false })).auto_restart, false);
	assert.equal("auto_restart" in (await sent({})), false);
});

test("as descrições citam o reinício automático", () => {
	for (const name of ["update_app_config", "create_app", "create_app_from_image"]) {
		assert.match(tool(name).description, /auto_restart/, name);
	}
});
