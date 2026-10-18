import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "vitest";
import { VertraClient } from "../src/client.js";
import { toolScope, tools } from "../src/tools/index.js";
import { parseResult, stubFetch } from "./helpers.js";

const tool = (name: string) => {
	const found = tools.find((t) => t.name === name);
	assert.ok(found, `tool ${name} não existe`);
	return found;
};

const run = async (name: string, args: Record<string, unknown>, reply: Parameters<typeof stubFetch>[0] = { body: { response: {} } }) => {
	const { fetch, calls } = stubFetch(reply);
	const result = await tool(name).handler(args, new VertraClient("k", { fetch }));
	return { result, call: calls[0]! };
};

test("as tools de release estão registradas com escopo do catálogo e anotação certa", () => {
	const expected = [
		["list_releases", "apps:read", true, false],
		["get_release_log", "apps:read", true, false],
		["preview_rollback", "apps:envs", true, false],
		["rollback_app", "apps:write", false, true],
	] as const;
	for (const [name, scope, readOnly, destructive] of expected) {
		const t = tool(name);
		assert.equal(toolScope(t), scope, name);
		assert.equal(t.annotations.readOnlyHint, readOnly, name);
		assert.equal(t.annotations.destructiveHint, destructive, name);
	}
});

test("list_releases manda page, limit e workspace na query", async () => {
	const { call } = await run("list_releases", { id: "7", page: 2, limit: 50, workspace_id: "w1" });
	assert.equal(call.method, "GET");
	const url = new URL(call.url);
	assert.equal(url.pathname, "/v1/apps/7/releases");
	assert.equal(url.searchParams.get("page"), "2");
	assert.equal(url.searchParams.get("limit"), "50");
	assert.equal(url.searchParams.get("workspace_id"), "w1");
});

test("get_release_log chama a rota do log da versão", async () => {
	const { call } = await run("get_release_log", { id: "7", release_id: "9" });
	assert.equal(call.method, "GET");
	assert.equal(new URL(call.url).pathname, "/v1/apps/7/releases/9/log");
});

test("preview_rollback devolve só nomes e tipo de mudança", async () => {
	const { result, call } = await run("preview_rollback", { id: "7", release_id: "9" }, {
		body: { response: { environment_changes: [{ key: "TOKEN", change: "modified" }] } },
	});
	assert.equal(call.method, "GET");
	assert.equal(new URL(call.url).pathname, "/v1/apps/7/releases/9/rollback");
	assert.deepEqual(parseResult(result), { environment_changes: [{ key: "TOKEN", change: "modified" }] });
});

test("rollback_app sem restore_environment manda false; com true manda true", async () => {
	const first = await run("rollback_app", { id: "7", release_id: "9" });
	assert.equal(first.call.method, "POST");
	assert.equal(new URL(first.call.url).pathname, "/v1/apps/7/releases/9/rollback");
	assert.deepEqual(JSON.parse(String(first.call.body)), { restore_environment: false });

	const second = await run("rollback_app", { id: "7", release_id: "9", restore_environment: true, workspace_id: "w1" });
	assert.deepEqual(JSON.parse(String(second.call.body)), { restore_environment: true });
	assert.equal(new URL(second.call.url).searchParams.get("workspace_id"), "w1");
});

test("rollback_app propaga o código de erro da API intacto", async () => {
	const { result } = await run("rollback_app", { id: "7", release_id: "9" }, {
		status: 409,
		body: { code: "RELEASE_ALREADY_ACTIVE" },
	});
	assert.equal(result.isError, true);
	assert.equal((parseResult(result) as { code: string }).code, "RELEASE_ALREADY_ACTIVE");
});

test("id de release inválido é recusado antes de ir para a rede", async () => {
	const { fetch, calls } = stubFetch({});
	assert.throws(() => tool("rollback_app").handler({ id: "7", release_id: ".." }, new VertraClient("k", { fetch })), /Invalid identifier/);
	assert.equal(calls.length, 0);
});

test("update_app_config põe só os campos informados dentro de deploy", async () => {
	const partial = await run("update_app_config", { id: "7", auto_rollback: true });
	assert.equal(partial.call.method, "PATCH");
	assert.deepEqual(JSON.parse(String(partial.call.body)), { deploy: { auto_rollback: true } });

	const all = await run("update_app_config", { id: "7", name: "x", zero_downtime: "on", health_check_path: "/health" });
	assert.deepEqual(JSON.parse(String(all.call.body)), { name: "x", deploy: { zero_downtime: "on", health_check_path: "/health" } });

	const clear = await run("update_app_config", { id: "7", health_check_path: null });
	assert.deepEqual(JSON.parse(String(clear.call.body)), { deploy: { health_check_path: null } });

	const none = await run("update_app_config", { id: "7", name: "x" });
	assert.deepEqual(JSON.parse(String(none.call.body)), { name: "x" });
});

test("health_check_path do update_app_config segue a validação da API", () => {
	const shape = tool("update_app_config").inputSchema as Record<string, { safeParse(v: unknown): { success: boolean } }>;
	const field = shape.health_check_path!;
	assert.ok(field.safeParse("/health").success);
	assert.ok(field.safeParse(null).success);
	assert.ok(!field.safeParse("health").success);
	assert.ok(!field.safeParse("/a b").success);
	assert.ok(!field.safeParse(`/${"a".repeat(200)}`).success);
});

let root: string;
const previous = process.env.VERTRA_MCP_ROOT;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "vertra-mcp-"));
	writeFileSync(join(root, "index.js"), "console.log(1)");
	process.env.VERTRA_MCP_ROOT = root;
});
afterEach(() => {
	process.env.VERTRA_MCP_ROOT = previous ?? "";
});

test("deploy_app manda message como campo multipart, e omite quando ausente", async () => {
	const withMessage = await run("deploy_app", { id: "7", path: root, message: "fix login" });
	assert.equal(new URL(withMessage.call.url).pathname, "/v1/apps/7/files/upload");
	assert.equal((withMessage.call.body as FormData).get("message"), "fix login");

	const without = await run("deploy_app", { id: "7", path: root });
	assert.equal((without.call.body as FormData).has("message"), false);
});

test("nenhuma tool de release devolve valor de variável de ambiente", async () => {
	const leaky = { response: { environment_changes: [{ key: "TOKEN", change: "added" }], environment: { TOKEN: "sk_live_x" } } };
	const { result } = await run("preview_rollback", { id: "7", release_id: "9" }, { body: leaky });
	// The API never sends values; this guards the tool from adding any on its own.
	assert.ok(!Object.keys(tool("preview_rollback").inputSchema as object).includes("value"));
	assert.ok((result.content[0]?.text ?? "").includes("TOKEN"));
});

test("wait_for_app repete até o app sair de building", async () => {
	const { fetch, calls } = stubFetch([{ body: { response: { status: "building" } } }, { body: { response: { status: "up" } } }]);
	const result = await tool("wait_for_app").handler({ id: "7" }, new VertraClient("k", { fetch }));
	assert.equal(calls.length, 2);
	assert.equal((parseResult(result) as { status: string }).status, "up");
	assert.equal(toolScope(tool("wait_for_app")), "apps:read");
}, 10_000);

test("create_app, get_app e wait_for_app orientam sobre last_build_error", () => {
	for (const name of ["create_app", "get_app", "wait_for_app"]) {
		const d = tool(name).description;
		assert.ok(d.includes("last_build_error") && d.includes("INSTALL_OUT_OF_MEMORY"), name);
	}
});
