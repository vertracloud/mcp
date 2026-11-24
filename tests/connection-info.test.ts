import assert from "node:assert/strict";
import { test } from "vitest";
import { VertraClient } from "../src/client.js";
import { tools } from "../src/tools/index.js";
import { parseResult, stubFetch } from "./helpers.js";

const tool = tools.find((t) => t.name === "get_connection_info");
const CA = "-----BEGIN CERTIFICATE-----\nMIIBxx\n-----END CERTIFICATE-----\n";
const database = { response: { id: "7", type: 1, version: "18", host: "h", port: 5432, username: "vertracloud" } };

async function run(certificate: { status?: number; body: unknown }) {
	const { fetch, calls } = stubFetch([{ body: database }, certificate]);
	const info = parseResult(await tool!.handler({ id: "7" }, new VertraClient("k", { fetch }))) as Record<string, unknown>;
	return { info, calls };
}

test("ca_pem é o campo ca do certificado e nunca o JSON da resposta", async () => {
	const { info, calls } = await run({ body: { response: { crt: "C", key: "K", pem: "P", ca: CA } } });
	assert.equal(info.ca_pem, CA);
	assert.equal(String(info.ca_pem).startsWith("{"), false);
	assert.ok(calls.some((c) => c.method === "GET" && c.url.includes("/credentials/certificate")));
});

test("sem ca no certificado, ca_pem é null e a chave privada não vaza", async () => {
	const { info } = await run({ body: { response: { crt: "C", key: "PRIVATE-KEY-VALUE", pem: "P" } } });
	assert.equal(info.ca_pem, null);
	assert.equal(JSON.stringify(info).includes("PRIVATE-KEY-VALUE"), false);
});

test("falha do certificado vira ca_error e mantém os dados do banco", async () => {
	const { info } = await run({ status: 403, body: { code: "API_KEY_SCOPE_DENIED" } });
	assert.equal(info.ca_pem, null);
	assert.equal((info.ca_error as { code: string }).code, "API_KEY_SCOPE_DENIED");
	assert.equal(info.id, "7");
});
