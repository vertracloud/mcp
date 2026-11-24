import assert from "node:assert/strict";
import type {
	APIApplicationFileDelete,
	APIDatabaseCertificateReset,
	APITemplateDeploy,
} from "@vertracloud/api-types/v1";
import { test } from "vitest";
import { type FetchLike, VertraClient } from "../src/client.js";
import { tools } from "../src/tools/index.js";
import { parseResult, stubFetch } from "./helpers.js";

const tool = (name: string) => {
	const found = tools.find((t) => t.name === name);
	assert.ok(found, `tool ${name} não existe`);
	return found;
};

const client = (fetch: FetchLike) => new VertraClient("k", { fetch });

test("create_database avisa que a senha só vem agora e a repassa", async () => {
	assert.match(tool("create_database").description, /`password`/);
	assert.match(tool("create_database").description, /only now|never shown again|will not be shown again/i);
	assert.match(tool("create_database").description, /reset_credentials/);
	const { fetch } = stubFetch({ status: 201, body: { response: { id: "db1", password: "pw-once" } } });
	const out = parseResult(await tool("create_database").handler({ engine: "postgresql", name: "a", ram: 512 }, client(fetch))) as Record<string, unknown>;
	assert.equal(out.password, "pw-once");
});

test("delete_file explica space_released e repassa a resposta", async () => {
	assert.match(tool("delete_file").description, /space_released/);
	assert.match(tool("delete_file").description, /on_restart/);
	const reply: APIApplicationFileDelete = { space_released: "on_restart" };
	const { fetch, calls } = stubFetch({ body: { response: reply } });
	const out = parseResult(await tool("delete_file").handler({ id: "a1", path: "/log.txt" }, client(fetch)));
	assert.deepEqual(out, reply);
	assert.equal(calls[0]?.method, "DELETE");
});

test("reset_certificate manda o banco legacy_host para o painel, explica a resposta e a repassa", async () => {
	for (const field of ["host", "client_variables_with_old_host", "apps_to_restart", "legacy_host", "WEBSITE_ONLY", "dashboard"]) assert.match(tool("reset_certificate").description, new RegExp(field));
	assert.doesNotMatch(tool("reset_certificate").description, /preview/);
	assert.equal(tools.some((t) => t.name === "preview_certificate_reset"), false);
	const reply: Partial<APIDatabaseCertificateReset> = {
		host: "new.example",
		client_variables_with_old_host: [],
		apps_to_restart: ["a2"],
	};
	const { fetch } = stubFetch({ body: { response: reply } });
	const out = parseResult(await tool("reset_certificate").handler({ id: "db1" }, client(fetch)));
	assert.deepEqual(out, reply);
});

test("get_database explica legacy_host e repassa o campo", async () => {
	assert.match(tool("get_database").description, /legacy_host/);
	assert.match(tool("get_database").description, /dashboard/);
	assert.match(tool("get_database").description, /WEBSITE_ONLY/);
	assert.doesNotMatch(tool("get_database").description, /preview/);
	const { fetch } = stubFetch({ body: { response: { id: "db1", legacy_host: true } } });
	const out = parseResult(await tool("get_database").handler({ id: "db1" }, client(fetch))) as Record<string, unknown>;
	assert.equal(out.legacy_host, true);
});

test("as tools de template dizem que as senhas dos bancos criados saem uma vez", () => {
	for (const name of ["deploy_template", "get_template_deploy"]) {
		assert.match(tool(name).description, /database_passwords/, name);
		assert.match(tool(name).description, /database.*password|password.*database/i, name);
	}
});

test("get_template_deploy entrega database_passwords na primeira leitura do job concluído", async () => {
	const passwords: APITemplateDeploy["database_passwords"] = [{ database_id: "db1", service_id: "pg", password: "pw-once" }];
	const { fetch } = stubFetch({ body: { response: { id: "j1", status: "succeeded", outputs: [], database_passwords: passwords } } });
	const out = parseResult(await tool("get_template_deploy").handler({ id: "j1" }, client(fetch))) as Record<string, unknown>;
	assert.deepEqual(out.database_passwords, passwords);
});

test("deploy_template entrega database_passwords quando o job conclui durante a espera", async () => {
	const passwords: APITemplateDeploy["database_passwords"] = [{ database_id: "db1", service_id: "pg", password: "pw-once" }];
	const { fetch } = stubFetch([
		{ status: 202, body: { response: { id: "j1", status: "running", outputs: [], database_passwords: [] } } },
		{ body: { response: { id: "j1", status: "succeeded", outputs: [], database_passwords: passwords } } },
	]);
	const out = parseResult(await tool("deploy_template").handler({ id: "n8n", name: "x", wait_seconds: 5 }, client(fetch))) as Record<string, unknown>;
	assert.deepEqual(out.database_passwords, passwords);
});
