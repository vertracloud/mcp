import assert from "node:assert/strict";
import { test } from "vitest";
import { z } from "zod";
import { VertraClient } from "../src/client.js";
import { tools } from "../src/tools/index.js";
import { parseResult, stubFetch } from "./helpers.js";

const tool = (name: string) => {
	const found = tools.find((t) => t.name === name);
	assert.ok(found, `tool ${name} não existe`);
	return found;
};

const schemaOf = (name: string) => z.object(tool(name).inputSchema as z.ZodRawShape);

test("as tools de custom domain antigas não existem mais", () => {
	assert.equal(tools.find((t) => t.name === "set_custom_domain"), undefined);
	assert.equal(tools.find((t) => t.name === "remove_custom_domain"), undefined);
});

test("get_network lista os domínios e não chama as rotas antigas", async () => {
	const { fetch, calls } = stubFetch({ body: { response: [{ id: "d1", hostname: "meu-app.com.br" }] } });

	const result = await tool("get_network").handler({ id: "app" }, new VertraClient("k", { fetch }));

	assert.equal(calls.length, 1);
	assert.ok(calls[0]?.url.endsWith("/v1/apps/app/domains"));
	assert.ok(!calls.some((c) => c.url.includes("/network/custom") || c.url.includes("/network/dns")));
	assert.deepEqual(parseResult(result), { domains: [{ id: "d1", hostname: "meu-app.com.br" }] });
});

test("list_domains faz GET /domains", async () => {
	const { fetch, calls } = stubFetch({ body: { response: [] } });
	await tool("list_domains").handler({ id: "app", workspace_id: "ws" }, new VertraClient("k", { fetch }));
	assert.equal(calls[0]?.method, "GET");
	assert.ok(calls[0]?.url.includes("/v1/apps/app/domains"));
	assert.ok(calls[0]?.url.includes("workspace_id=ws"));
});

test("add_domain envia só os campos informados", async () => {
	const { fetch, calls } = stubFetch({ body: { response: [] } });
	await tool("add_domain").handler(
		{ id: "app", hostname: "meu-app.com.br", port: 3000, path_prefix: "/api", www: false },
		new VertraClient("k", { fetch }),
	);
	assert.equal(calls[0]?.method, "POST");
	assert.ok(calls[0]?.url.includes("/v1/apps/app/domains"));
	assert.deepEqual(JSON.parse(String(calls[0]?.body)), { hostname: "meu-app.com.br", www: false, port: 3000, path_prefix: "/api" });
});

test("update_domain: null limpa prefixo e redirect", async () => {
	const { fetch, calls } = stubFetch({ body: { response: [] } });
	await tool("update_domain").handler(
		{ id: "app", domain_id: "d1", path_prefix: null, redirect_to: null, primary: true },
		new VertraClient("k", { fetch }),
	);
	assert.equal(calls[0]?.method, "PATCH");
	assert.ok(calls[0]?.url.includes("/v1/apps/app/domains/d1"));
	assert.deepEqual(JSON.parse(String(calls[0]?.body)), { path_prefix: null, redirect_to: null, primary: true });
});

test("remove_domain, get_domain_dns e get_domain_connect_url usam as rotas do domínio", async () => {
	const { fetch, calls } = stubFetch({ body: { response: null } });
	const client = new VertraClient("k", { fetch });
	await tool("remove_domain").handler({ id: "app", domain_id: "d1" }, client);
	await tool("get_domain_dns").handler({ id: "app", domain_id: "d1" }, client);
	await tool("get_domain_connect_url").handler({ id: "app", domain_id: "d1" }, client);
	assert.deepEqual(
		calls.map((c) => `${c.method} ${new URL(c.url).pathname}`),
		["DELETE /v1/apps/app/domains/d1", "GET /v1/apps/app/domains/d1/dns", "POST /v1/apps/app/domains/d1/connect"],
	);
});

test("domain_id que normaliza o caminho é recusado antes da chamada", async () => {
	const { fetch, calls } = stubFetch({ body: {} });
	await assert.rejects(async () => tool("remove_domain").handler({ id: "app", domain_id: ".." }, new VertraClient("k", { fetch })));
	assert.equal(calls.length, 0);
});

test("schema de add_domain aplica os limites do contrato", () => {
	const schema = schemaOf("add_domain");
	const base = { id: "app", hostname: "meu-app.com.br" };
	assert.ok(schema.safeParse(base).success);
	assert.ok(schema.safeParse({ ...base, port: 1 }).success);
	assert.ok(schema.safeParse({ ...base, port: 65535 }).success);
	assert.ok(!schema.safeParse({ ...base, port: 0 }).success);
	assert.ok(!schema.safeParse({ ...base, port: 65536 }).success);
	assert.ok(!schema.safeParse({ ...base, port: 80.5 }).success);
	for (const status of [301, 302, 307, 308]) assert.ok(schema.safeParse({ ...base, redirect_status: status }).success);
	assert.ok(!schema.safeParse({ ...base, redirect_status: 303 }).success);
	assert.ok(schema.safeParse({ ...base, path_prefix: "/api" }).success);
	assert.ok(!schema.safeParse({ ...base, path_prefix: "api" }).success);
	assert.ok(!schema.safeParse({ ...base, path_prefix: "/api/" }).success);
	assert.ok(schema.safeParse({ ...base, path_prefix: "/api/v1" }).success);
	for (const bad of ["/", "/a b", "/a//b", "/a/./b", "/a/../b", "/..", "/.", "/a?x", `/${"a".repeat(128)}`]) {
		assert.ok(!schema.safeParse({ ...base, path_prefix: bad }).success, bad);
	}
	assert.ok(schema.safeParse({ ...base, path_prefix: `/${"a".repeat(127)}` }).success);
});

test("schema de update_domain aceita null para limpar e só primary: true", () => {
	const schema = schemaOf("update_domain");
	const base = { id: "app", domain_id: "d1" };
	assert.ok(schema.safeParse({ ...base, path_prefix: null, redirect_to: null }).success);
	assert.ok(!schema.safeParse({ ...base, path_prefix: "api" }).success);
	assert.ok(!schema.safeParse({ ...base, port: 70000 }).success);
	assert.ok(!schema.safeParse({ ...base, redirect_status: 200 }).success);
	assert.ok(schema.safeParse({ ...base, primary: true }).success);
	assert.ok(!schema.safeParse({ ...base, primary: false }).success);
});

test("unpublish_app avisa que remove os domínios próprios", () => {
	assert.match(tool("unpublish_app").description, /custom domains/i);
	assert.match(tool("unpublish_app").description, /DNS/);
	assert.equal(tool("unpublish_app").annotations.destructiveHint, true);
});

test("remove_domain só diz que o companheiro sai junto quando o alvo não é o companheiro", () => {
	const description = tool("remove_domain").description;
	assert.match(description, /unless the target is itself an automatic companion/i);
	assert.match(description, /only that domain/i);
});

test("anotações das tools de domínio: só leitura lê, o que muda o tráfego é destrutivo", () => {
	for (const name of ["get_network", "list_domains", "get_domain_dns"]) {
		assert.equal(tool(name).annotations.readOnlyHint, true, name);
		assert.equal(tool(name).annotations.destructiveHint, false, name);
	}
	for (const name of ["update_domain", "remove_domain"]) {
		assert.equal(tool(name).annotations.readOnlyHint, false, name);
		assert.equal(tool(name).annotations.destructiveHint, true, name);
	}
	for (const name of ["add_domain", "get_domain_connect_url"]) {
		assert.equal(tool(name).annotations.readOnlyHint, false, name);
		assert.equal(tool(name).annotations.destructiveHint, false, name);
	}
});
