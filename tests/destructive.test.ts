import assert from "node:assert/strict";
import { test } from "vitest";
import { VertraClient } from "../src/client.js";
import { tools } from "../src/tools/index.js";
import { parseResult, stubFetch } from "./helpers.js";

function tool(name: string) {
	const found = tools.find((t) => t.name === name);
	if (!found) throw new Error(`tool ${name} not found`);
	return found;
}

test("delete_app, delete_database e reset_database não têm campo extra e sugerem create_snapshot", () => {
	for (const name of ["delete_app", "delete_database", "reset_database"]) {
		assert.deepEqual(Object.keys(tool(name).inputSchema).sort(), ["id", "workspace_id"]);
		assert.match(tool(name).description, /create_snapshot/);
	}
	assert.match(tool("restore_snapshot").description, /create_snapshot/);
});

test("delete_app roda na hora: sem parâmetro extra e a resposta vazia é devolvida", async () => {
	const { fetch, calls } = stubFetch({ body: { response: null } });
	const result = await tool("delete_app").handler({ id: "a1" }, new VertraClient("k", { fetch }));

	assert.equal(result.isError, undefined);
	assert.equal(calls[0]?.method, "DELETE");
	assert.equal([...new URL(calls[0]?.url ?? "").searchParams.keys()].length, 0);
});

test("delete_database devolve o id do response", async () => {
	const { fetch, calls } = stubFetch({ body: { response: "d1" } });
	const parsed = parseResult(await tool("delete_database").handler({ id: "d1" }, new VertraClient("k", { fetch })));

	assert.equal(new URL(calls[0]?.url ?? "").pathname, "/v1/databases/d1");
	assert.equal(parsed, "d1");
});

test("reset_database não manda corpo e devolve o status", async () => {
	const { fetch, calls } = stubFetch({ body: { response: { status: "success" } } });
	const reset = parseResult(await tool("reset_database").handler({ id: "d1" }, new VertraClient("k", { fetch })));

	assert.equal(calls[0]?.body, undefined);
	assert.deepEqual(reset, { status: "success" });
});

test("restore_snapshot manda só restore_image_version no corpo e devolve o job", async () => {
	const { fetch, calls } = stubFetch({ status: 202, body: { response: { job_id: "j1" } } });
	const parsed = parseResult(
		await tool("restore_snapshot").handler(
			{ scope: "applications", resource_id: "a1", snapshot_id: "s1", restore_image_version: true },
			new VertraClient("k", { fetch }),
		),
	);

	assert.deepEqual(JSON.parse(String(calls[0]?.body)), { restore_image_version: true });
	assert.equal((parsed as { job_id: string }).job_id, "j1");
});

test("429 lê retry_after de details quando não há header", async () => {
	const { fetch } = stubFetch({ status: 429, body: { code: "SNAPSHOT_RATE_LIMITED", details: { scope: "account", retry_after: 5 } } });
	const res = await new VertraClient("k", { fetch }).post("/v1/users/a1/snapshots");

	assert.equal((res.body as { retry_after?: number }).retry_after, 5);
});

test("create_snapshot espera mais que os 30 s padrão", async () => {
	const spy: number[] = [];
	const original = AbortSignal.timeout;
	AbortSignal.timeout = (ms: number) => {
		spy.push(ms);
		return original.call(AbortSignal, ms);
	};
	try {
		const { fetch } = stubFetch({ body: { response: {} } });
		await tool("create_snapshot").handler({ scope: "databases", resource_id: "d1" }, new VertraClient("k", { fetch }));
	} finally {
		AbortSignal.timeout = original;
	}

	assert.ok((spy[0] ?? 0) > 95_000);
});
