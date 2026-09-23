import assert from "node:assert/strict";
import { API_KEY_SCOPES } from "@vertracloud/api-types/payloads/v1";
import { test } from "vitest";
import { VertraClient } from "../src/client.js";
import { decodeFileContent } from "../src/tools/files.js";
import { scopeForRoute, toolScope, tools } from "../src/tools/index.js";
import { connectionString, engineName } from "../src/tools/databases.js";
import { parseResult, stubFetch } from "./helpers.js";

const tool = (name: string) => {
	const found = tools.find((t) => t.name === name);
	assert.ok(found, `tool ${name} não existe`);
	return found;
};

test("toda tool com rota deriva um escopo do catálogo", () => {
	for (const t of tools) {
		if (!t.route) continue;
		assert.ok(toolScope(t), `${t.name}: rota ${t.route[0]} ${t.route[1]} não está no catálogo de escopos`);
	}
});

test("a rota declarada existe no catálogo, exatamente como escrita", () => {
	const known = new Set(
		Object.values(API_KEY_SCOPES).flatMap((entry) => entry.routes.map((r) => `${r.method} ${r.path}`)),
	);
	for (const t of tools) {
		if (!t.route) continue;
		assert.ok(known.has(`${t.route[0]} ${t.route[1]}`), `${t.name}: ${t.route[0]} ${t.route[1]}`);
	}
});

test("nomes de tool são únicos e toda tool declara as três anotações", () => {
	const names = new Set<string>();
	for (const t of tools) {
		assert.ok(!names.has(t.name), `nome duplicado: ${t.name}`);
		names.add(t.name);
		assert.equal(typeof t.annotations.readOnlyHint, "boolean");
		assert.equal(typeof t.annotations.destructiveHint, "boolean");
		assert.equal(typeof t.annotations.idempotentHint, "boolean");
		assert.ok(!(t.annotations.readOnlyHint && t.annotations.destructiveHint), `${t.name}: leitura e destrutiva`);
	}
});

test("scopeForRoute devolve o escopo do catálogo e null fora dele", () => {
	assert.equal(scopeForRoute("GET", "/v1/apps/:id/logs"), "apps:read");
	assert.equal(scopeForRoute("POST", "/v1/orders"), "billing:write");
	assert.equal(scopeForRoute("DELETE", "/v1/users/me/sessions"), null);
});

test("read_file decodifica texto e mantém binário em base64", () => {
	const text = decodeFileContent({ type: "base64", data: Buffer.from("olá mundo").toString("base64"), size: 10 });
	assert.deepEqual(text, { size: 10, last_modified: undefined, encoding: "utf-8", content: "olá mundo" });

	const binary = decodeFileContent({ type: "base64", data: Buffer.from([0x00, 0x01, 0xff]).toString("base64") });
	assert.equal((binary as { encoding: string }).encoding, "base64");
});

test("string de conexão por engine, e null sem credencial", () => {
	assert.equal(engineName(1), "postgresql");
	assert.equal(
		connectionString("postgresql", { host: "h", port: 5432, user: "u", password: "p p", database: "d" }),
		"postgresql://u:p%20p@h:5432/d?sslmode=verify-ca",
	);
	assert.equal(connectionString("redis", { host: "h", port: 6379, user: "u", password: "p" }), "rediss://u:p@h:6379");
	assert.equal(connectionString("mongodb", { host: "h", port: 27017, user: "u", password: "p", database: "d" }), "mongodb://u:p@h:27017/d?tls=true");
	assert.equal(connectionString("postgresql", { host: "h", port: 5432 }), null);
});

test("get_connection_info junta banco e certificado sem inventar credencial", async () => {
	const { fetch } = stubFetch([
		{ body: { response: { id: "7", type: 1, host: "db.example", port: 5432 } } },
		{ body: "-----BEGIN CERTIFICATE-----" },
	]);

	const result = await tool("get_connection_info").handler({ id: "7" }, new VertraClient("k", { fetch }));
	const info = parseResult(result) as Record<string, unknown>;

	assert.equal(info.engine, "postgresql");
	assert.equal(info.host, "db.example");
	assert.equal(info.user, null);
	assert.equal(info.connection_string, null);
	assert.ok(String(info.note).length > 0);
});

test("get_app_status sem id consulta a rota de todos", async () => {
	const { fetch, calls } = stubFetch({ body: { response: [] } });
	await tool("get_app_status").handler({}, new VertraClient("k", { fetch }));
	assert.equal(calls[0]?.url, "https://api.vertracloud.app/v1/apps/status");
});

test("get_logs recorta as últimas linhas quando `tail` é pedido", async () => {
	const { fetch } = stubFetch({ body: { response: "l1\nl2\nl3\nl4" } });
	const result = await tool("get_logs").handler({ id: "a", tail: 2 }, new VertraClient("k", { fetch }));
	assert.equal(result.content[0]?.text, "l3\nl4");
});

test("id vindo do agente é escapado na URL", async () => {
	const { fetch, calls } = stubFetch({ body: {} });
	await tool("get_app").handler({ id: "../../v1/users/me" }, new VertraClient("k", { fetch }));
	assert.equal(calls[0]?.url, "https://api.vertracloud.app/v1/apps/..%2F..%2Fv1%2Fusers%2Fme");
});

test("erro da API chega ao agente com isError e o envelope intacto", async () => {
	const { fetch } = stubFetch({ status: 403, body: { code: "API_KEY_SCOPE_DENIED", details: { scope: "apps:read" } } });
	const result = await tool("get_app").handler({ id: "1" }, new VertraClient("k", { fetch }));

	assert.equal(result.isError, true);
	assert.deepEqual(parseResult(result), { code: "API_KEY_SCOPE_DENIED", details: { scope: "apps:read" } });
});

test("`..` como identificador é recusado antes de virar outra rota", async () => {
	const { fetch, calls } = stubFetch({ body: {} });
	await assert.rejects(async () => tool("get_app").handler({ id: ".." }, new VertraClient("k", { fetch })));
	assert.equal(calls.length, 0);
});

test("list_sessions não devolve IP nem localização", async () => {
	const { fetch } = stubFetch({
		body: { response: [{ id: "s1", provider: "google", ip_address: "203.0.113.9", location: "Fortaleza, BR", device: "Mac", created_at: "2026-09-01" }] },
	});
	const result = await tool("list_sessions").handler({}, new VertraClient("k", { fetch }));
	const text = result.content[0]?.text ?? "";

	assert.ok(!text.includes("203.0.113.9"));
	assert.ok(!text.includes("Fortaleza"));
	assert.deepEqual(parseResult(result), [{ id: "s1", provider: "google", created_at: "2026-09-01" }]);
});

