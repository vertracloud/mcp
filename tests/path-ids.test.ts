import assert from "node:assert/strict";
import { test } from "vitest";
import type { ZodTypeAny } from "zod";
import { VertraClient } from "../src/client.js";
import { tools } from "../src/tools/index.js";
import { enc } from "../src/tools/util.js";
import { stubFetch } from "./helpers.js";

const PATH_ID_KEYS = new Set([
	"id",
	"app_id",
	"database_id",
	"user_id",
	"role_id",
	"invite_id",
	"release_id",
	"domain_id",
	"env_id",
	"folder_id",
	"resource_id",
	"snapshot_id",
	"order_id",
	"workspace_id",
	"token",
	"code",
]);

test("enc recusa vazio, . e .. também codificados", () => {
	for (const bad of ["", ".", "..", "%2e%2e", "%2E.", ".%2e", "%2e", "%252e%252e"]) {
		assert.throws(() => enc(bad), /Invalid identifier/, JSON.stringify(bad));
	}
	assert.equal(enc("a b/c"), "a%20b%2Fc");
	assert.equal(enc("..a"), "..a");
	assert.equal(enc("%zz"), "%25zz");
});

test("todo id que vira segmento de path recusa string vazia no schema", () => {
	let checked = 0;
	for (const tool of tools) {
		for (const [key, schema] of Object.entries(tool.inputSchema as Record<string, ZodTypeAny>)) {
			if (!PATH_ID_KEYS.has(key) || schema.isOptional()) continue;
			checked++;
			assert.equal(schema.safeParse("").success, false, `${tool.name}.${key} aceita ""`);
		}
	}
	assert.ok(checked > 60, `só ${checked} ids conferidos`);
});

test("remove_domain com domain_id codificado não chama a API", async () => {
	const { fetch, calls } = stubFetch({ body: {} });
	const remove = tools.find((t) => t.name === "remove_domain");
	assert.ok(remove);
	for (const bad of ["..", "%2e%2e", "%2E.", ""]) {
		await assert.rejects(async () => remove.handler({ id: "app", domain_id: bad }, new VertraClient("k", { fetch })));
	}
	assert.equal(calls.length, 0);
});
