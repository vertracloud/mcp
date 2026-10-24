import assert from "node:assert/strict";
import { test } from "vitest";
import { VertraClient } from "../src/client.js";
import { scopeForRoute, toolScope, tools } from "../src/tools/index.js";
import { parseResult, stubFetch } from "./helpers.js";

const tool = (name: string) => {
	const found = tools.find((t) => t.name === name);
	assert.ok(found, `tool ${name} não existe`);
	return found;
};

test("list_database_versions é somente leitura e deriva databases:read da rota", () => {
	const t = tool("list_database_versions");
	assert.equal(scopeForRoute("GET", "/v1/databases/versions"), "databases:read");
	assert.equal(toolScope(t), "databases:read");
	assert.equal(t.annotations.readOnlyHint, true);
	assert.equal(t.group, "databases");
});

test("list_database_versions chama GET /v1/databases/versions e devolve o catálogo", async () => {
	const catalog = { "1": { recommended: "18", available: ["18", "17"] } };
	const { fetch, calls } = stubFetch({ body: { response: catalog } });
	const parsed = parseResult(await tool("list_database_versions").handler({}, new VertraClient("k", { fetch })));
	assert.equal(calls[0]?.method, "GET");
	assert.ok(calls[0]?.url.endsWith("/v1/databases/versions"));
	assert.deepEqual(parsed, catalog);
});

test("create_database manda version só quando informada", async () => {
	const withVersion = stubFetch({ body: { response: { id: "1" } } });
	await tool("create_database").handler({ engine: "postgresql", name: "a", ram: 512, version: "17" }, new VertraClient("k", { fetch: withVersion.fetch }));
	assert.equal(JSON.parse(String(withVersion.calls[0]?.body)).version, "17");

	const without = stubFetch({ body: { response: { id: "1" } } });
	await tool("create_database").handler({ engine: "postgresql", name: "a", ram: 512 }, new VertraClient("k", { fetch: without.fetch }));
	assert.equal("version" in JSON.parse(String(without.calls[0]?.body)), false);
	assert.match(tool("create_database").description, /recommended/);
});

test("get_connection_info inclui a linha de versão", async () => {
	const { fetch } = stubFetch([{ body: { response: { id: "7", type: 1, version: "18", host: "h", port: 5432, username: "vertracloud" } } }, { body: "pem" }]);
	const info = parseResult(await tool("get_connection_info").handler({ id: "7" }, new VertraClient("k", { fetch }))) as Record<string, unknown>;
	assert.equal(info.version, "18");
});
