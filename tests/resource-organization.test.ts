import assert from "node:assert/strict";
import { test } from "vitest";
import { VertraClient } from "../src/client.js";
import { toolScope, tools } from "../src/tools/index.js";
import { parseResult, stubFetch } from "./helpers.js";

const tool = (name: string) => {
	const found = tools.find((entry) => entry.name === name);
	assert.ok(found, `tool ${name} não existe`);
	return found;
};

const schema = (name: string) => tool(name).inputSchema as { safeParse(value: unknown): { success: boolean } };

const body = (value: unknown): unknown => (typeof value === "string" ? JSON.parse(value) : value);

test("registra as tools de organização com rotas e scopes explícitos por escopo", () => {
	const expected: Array<[string, string, string, string]> = [
		["create_personal_folder", "POST", "/v1/users/me/folders", "account:write"],
		["update_personal_folder", "PATCH", "/v1/users/me/folders/:folder_id", "account:write"],
		["delete_personal_folder", "DELETE", "/v1/users/me/folders/:folder_id", "account:write"],
		["add_personal_resource_to_folder", "PUT", "/v1/users/me/folders/:folder_id/resources/:resource_type/:resource_id", "account:write"],
		["remove_personal_resource_from_folder", "DELETE", "/v1/users/me/folders/:folder_id/resources/:resource_type/:resource_id", "account:write"],
		["favorite_personal_resource", "PUT", "/v1/users/me/favorites/:resource_type/:resource_id", "account:write"],
		["unfavorite_personal_resource", "DELETE", "/v1/users/me/favorites/:resource_type/:resource_id", "account:write"],
		["create_workspace_folder", "POST", "/v1/workspaces/:id/folders", "workspaces:write"],
		["update_workspace_folder", "PATCH", "/v1/workspaces/:id/folders/:folder_id", "workspaces:write"],
		["delete_workspace_folder", "DELETE", "/v1/workspaces/:id/folders/:folder_id", "workspaces:write"],
		["add_workspace_resource_to_folder", "PUT", "/v1/workspaces/:id/folders/:folder_id/resources/:resource_type/:resource_id", "workspaces:write"],
		["remove_workspace_resource_from_folder", "DELETE", "/v1/workspaces/:id/folders/:folder_id/resources/:resource_type/:resource_id", "workspaces:write"],
		["favorite_workspace_resource", "PUT", "/v1/workspaces/:id/favorites/:resource_type/:resource_id", "workspaces:write"],
		["unfavorite_workspace_resource", "DELETE", "/v1/workspaces/:id/favorites/:resource_type/:resource_id", "workspaces:write"],
	];

	for (const [name, method, path, scope] of expected) {
		assert.deepEqual(tool(name).route, [method, path]);
		assert.equal(toolScope(tool(name)), scope);
	}
});

test("cria pasta pessoal com apenas o corpo permitido", async () => {
	const { fetch, calls } = stubFetch({ body: { response: { id: "folder-1" } } });
	const result = await tool("create_personal_folder").handler(
		{ name: "Produção", color: "blue", position: 2, origin: "user" },
		new VertraClient("k", { fetch }),
	);

	assert.deepEqual(parseResult(result), { id: "folder-1" });
	assert.equal(calls[0]?.method, "POST");
	assert.equal(calls[0]?.url, "https://api.vertracloud.app/v1/users/me/folders");
	assert.deepEqual(body(calls[0]?.body), { name: "Produção", color: "blue", position: 2 });
});

test("atualiza uma pasta de workspace com IDs escapados", async () => {
	const { fetch, calls } = stubFetch({ body: { response: {} } });
	await tool("update_workspace_folder").handler(
		{ workspace_id: "ws/1", folder_id: "folder/1", name: "Novo nome", color: "green", author_id: "x" },
		new VertraClient("k", { fetch }),
	);

	assert.equal(calls[0]?.method, "PATCH");
	assert.equal(calls[0]?.url, "https://api.vertracloud.app/v1/workspaces/ws%2F1/folders/folder%2F1");
	assert.deepEqual(body(calls[0]?.body), { name: "Novo nome", color: "green" });
});

test("adiciona e remove recurso usando a rota tipada", async () => {
	const { fetch, calls } = stubFetch([{ body: { response: {} } }, { body: { response: {} } }]);
	const client = new VertraClient("k", { fetch });

	await tool("add_personal_resource_to_folder").handler(
		{ folder_id: "folder/1", resource_type: "application", resource_id: "app/1", position: 3 },
		client,
	);
	await tool("remove_personal_resource_from_folder").handler(
		{ folder_id: "folder/1", resource_type: "application", resource_id: "app/1" },
		client,
	);

	assert.equal(calls[0]?.method, "PUT");
	assert.equal(calls[0]?.url, "https://api.vertracloud.app/v1/users/me/folders/folder%2F1/resources/application/app%2F1");
	assert.deepEqual(body(calls[0]?.body), { position: 3 });
	assert.equal(calls[1]?.method, "DELETE");
	assert.equal(calls[1]?.url, "https://api.vertracloud.app/v1/users/me/folders/folder%2F1/resources/application/app%2F1");
	assert.equal(calls[1]?.body, undefined);
});

test("favorito de workspace usa o scope do workspace e não aceita origin", async () => {
	const { fetch, calls } = stubFetch([{ body: { response: {} } }, { body: { response: {} } }]);
	const client = new VertraClient("k", { fetch });

	await tool("favorite_workspace_resource").handler(
		{ workspace_id: "ws-1", resource_type: "database", resource_id: "db-1", origin: "api_key" },
		client,
	);
	await tool("unfavorite_personal_resource").handler(
		{ resource_type: "database", resource_id: "db-1", author_id: "user-1" },
		client,
	);

	assert.equal(calls[0]?.method, "PUT");
	assert.equal(calls[0]?.url, "https://api.vertracloud.app/v1/workspaces/ws-1/favorites/database/db-1");
	assert.deepEqual(body(calls[0]?.body), {});
	assert.equal(calls[1]?.method, "DELETE");
	assert.equal(calls[1]?.url, "https://api.vertracloud.app/v1/users/me/favorites/database/db-1");
});

test("schemas estritos recusam campos desconhecidos, tipos e cores fora do contrato", () => {
	assert.equal(schema("create_personal_folder").safeParse({ name: "x", origin: "user" }).success, false);
	assert.equal(schema("add_personal_resource_to_folder").safeParse({ folder_id: "f", resource_type: "service", resource_id: "r" }).success, false);
	assert.equal(schema("create_personal_folder").safeParse({ name: "x", color: "pink" }).success, false);
	assert.equal(schema("update_personal_folder").safeParse({ folder_id: "f" }).success, false);
	assert.equal(schema("favorite_workspace_resource").safeParse({ workspace_id: "w", resource_type: "application", resource_id: "a", author_id: "u" }).success, false);
});
