import assert from "node:assert/strict";
import { test } from "vitest";
import { VertraClient } from "../src/client.js";
import { tools } from "../src/tools/index.js";
import { parseResult, stubFetch } from "./helpers.js";

const tool = (name: string) => {
	const found = tools.find((t) => t.name === name);
	assert.ok(found, `tool ${name} não existe`);
	return found;
};

test("list_envs nunca devolve o valor da variável", async () => {
	const { fetch } = stubFetch({
		body: {
			response: [
				{ id: "1", key: "DATABASE_URL", value: "postgresql://user:SENHA_SECRETA@host/db", created_at: "2026-09-01" },
				{ id: "2", key: "TOKEN", value: "sk_live_muito_secreto" },
			],
		},
	});

	const result = await tool("list_envs").handler({ id: "app" }, new VertraClient("k", { fetch }));
	const text = result.content[0]?.text ?? "";

	assert.ok(text.includes("DATABASE_URL"));
	assert.ok(!text.includes("SENHA_SECRETA"));
	assert.ok(!text.includes("sk_live_muito_secreto"));
	assert.ok(!text.includes("postgresql://"));
	assert.deepEqual((parseResult(result) as { variables: unknown[] }).variables[0], {
		key: "DATABASE_URL",
		id: "1",
		created_at: "2026-09-01",
	});
});

test("set_env confirma a chave sem ecoar o valor", async () => {
	const { fetch, calls } = stubFetch({ body: { response: [{ id: "1", key: "TOKEN", value: "sk_live_x" }] } });

	const result = await tool("set_env").handler({ id: "app", key: "TOKEN", value: "sk_live_x" }, new VertraClient("k", { fetch }));

	assert.deepEqual(parseResult(result), { key: "TOKEN", ok: true });
	assert.ok(!(result.content[0]?.text ?? "").includes("sk_live_x"));
	assert.ok(String(calls[0]?.body).includes("sk_live_x"));
});

test("não existe ferramenta que leia o valor de uma variável", () => {
	assert.equal(
		tools.filter((t) => t.group === "envs").map((t) => t.name).join(","),
		"list_envs,set_env,delete_env",
	);
});
