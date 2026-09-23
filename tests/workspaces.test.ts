import assert from "node:assert/strict";
import { test } from "vitest";
import { VertraClient } from "../src/client.js";
import { toolScope, tools } from "../src/tools/index.js";
import { stubFetch } from "./helpers.js";

const tool = (name: string) => {
	const found = tools.find((entry) => entry.name === name);
	assert.ok(found, `tool ${name} não existe`);
	return found;
};

const body = (value: unknown): unknown => (typeof value === "string" ? JSON.parse(value) : value);

test("tools de convite, exclusão e pedido de ação usam o escopo do catálogo", () => {
	const expected: Array<[string, string, string, string, boolean]> = [
		["delete_workspace", "DELETE", "/v1/workspaces/:id", "workspaces:delete", true],
		["list_workspace_invites", "GET", "/v1/workspaces/:id/invites", "workspaces:invites", false],
		["revoke_workspace_invite", "DELETE", "/v1/workspaces/:id/invites/:invite_id", "workspaces:invites", true],
		["preview_workspace_invite", "GET", "/v1/workspaces/invites/:token", "workspaces:invites", false],
		["accept_workspace_invite", "POST", "/v1/workspaces/invites/:token/accept", "workspaces:invites", false],
		["decline_workspace_invite", "POST", "/v1/workspaces/invites/:token/decline", "workspaces:invites", true],
		["list_action_requests", "GET", "/v1/workspaces/:id/action-requests", "workspaces:read", false],
		["create_action_request", "POST", "/v1/workspaces/:id/action-requests", "workspaces:write", false],
	];
	for (const [name, method, path, scope, destructive] of expected) {
		assert.deepEqual(tool(name).route, [method, path]);
		assert.equal(toolScope(tool(name)), scope);
		assert.equal(tool(name).annotations.destructiveHint, destructive, name);
	}
});

test("ações só do painel não viram tool", () => {
	const routes = new Set(tools.filter((t) => t.route).map((t) => `${t.route?.[0]} ${t.route?.[1]}`));
	for (const route of [
		"POST /v1/workspaces/:id/invites",
		"POST /v1/workspaces/:id/transfer-ownership",
		"POST /v1/workspaces/:id/action-requests/:request_id/approve",
		"POST /v1/workspaces/:id/action-requests/:request_id/reject",
		"GET /v1/workspaces/:id/activities/export",
	]) {
		assert.ok(!routes.has(route), route);
	}
});

test("aceitar convite escapa o token na URL", async () => {
	const { fetch, calls } = stubFetch({ body: { response: {} } });
	await tool("accept_workspace_invite").handler({ token: "a/b" }, new VertraClient("k", { fetch }));
	assert.equal(calls[0]?.method, "POST");
	assert.equal(calls[0]?.url, "https://api.vertracloud.app/v1/workspaces/invites/a%2Fb/accept");
});

test("create_action_request só manda params em snapshot_restore", async () => {
	const { fetch, calls } = stubFetch({ body: { response: {} } });
	const client = new VertraClient("k", { fetch });
	await tool("create_action_request").handler({ id: "w", action: "app_delete", resource_id: "a" }, client);
	await tool("create_action_request").handler({ id: "w", action: "snapshot_restore", resource_id: "a", snapshot_id: "s" }, client);
	assert.deepEqual(body(calls[0]?.body), { action: "app_delete", resource_id: "a" });
	assert.deepEqual(body(calls[1]?.body), { action: "snapshot_restore", resource_id: "a", params: { snapshot_id: "s" } });
});

test("list_action_requests repassa o filtro de status", async () => {
	const { fetch, calls } = stubFetch({ body: { response: [] } });
	await tool("list_action_requests").handler({ id: "w", status: "pending" }, new VertraClient("k", { fetch }));
	assert.equal(calls[0]?.url, "https://api.vertracloud.app/v1/workspaces/w/action-requests?status=pending");
});
