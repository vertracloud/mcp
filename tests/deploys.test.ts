import assert from "node:assert/strict";
import { test } from "vitest";
import { z } from "zod";
import { VertraClient } from "../src/client.js";
import { tools } from "../src/tools/index.js";
import { stubFetch } from "./helpers.js";

const tool = (name: string) => {
	const found = tools.find((t) => t.name === name);
	assert.ok(found, `tool ${name} não existe`);
	return found;
};

const schemaOf = (name: string) => z.object(tool(name).inputSchema as z.ZodRawShape);

const repo = { id: "app", owner: "acme", repo_name: "site", repo_id: "123", account_id: "456" };

test("create_deploy_webhook aceita branch opcional", () => {
	const schema = schemaOf("create_deploy_webhook");
	assert.equal(schema.safeParse(repo).success, true);
	assert.equal(schema.safeParse({ ...repo, branch: "release" }).success, true);
	assert.equal(schema.safeParse({ ...repo, branch: 1 }).success, false);
});

test("create_deploy_webhook envia branch quando informada", async () => {
	const { fetch, calls } = stubFetch({ body: { response: { url: "https://x/hook" } } });
	await tool("create_deploy_webhook").handler({ ...repo, branch: "release" }, new VertraClient("k", { fetch }));
	assert.equal(calls[0]?.method, "POST");
	assert.ok(calls[0]?.url.includes("/v1/apps/app/deploys/webhook"));
	assert.deepEqual(JSON.parse(String(calls[0]?.body)), {
		owner: "acme",
		repo_name: "site",
		repo_id: "123",
		account_id: "456",
		branch: "release",
	});
});

test("create_deploy_webhook sem branch mantém o corpo antigo", async () => {
	const { fetch, calls } = stubFetch({ body: { response: { url: "https://x/hook" } } });
	await tool("create_deploy_webhook").handler(repo, new VertraClient("k", { fetch }));
	assert.deepEqual(JSON.parse(String(calls[0]?.body)), { owner: "acme", repo_name: "site", repo_id: "123", account_id: "456" });
});
