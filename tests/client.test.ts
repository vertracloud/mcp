import assert from "node:assert/strict";
import { test } from "vitest";
import { VertraClient } from "../src/client.js";
import { stubFetch } from "./helpers.js";

test("envia a Bearer e desembrulha o envelope de sucesso", async () => {
	const { fetch, calls } = stubFetch({ body: { response: { id: "42" } } });
	const client = new VertraClient("chave", { fetch });

	const res = await client.get("/v1/apps/42");

	assert.equal(res.ok, true);
	assert.deepEqual(res.body, { id: "42" });
	assert.equal(calls[0]?.headers.Authorization, "Bearer chave");
	assert.equal(calls[0]?.url, "https://api.vertracloud.app/v1/apps/42");
});

test("preserva o código de erro da API", async () => {
	const { fetch } = stubFetch({ status: 403, body: { code: "API_KEY_SCOPE_DENIED", message: "sem escopo" } });
	const res = await new VertraClient("k", { fetch }).get("/v1/apps");

	assert.equal(res.ok, false);
	assert.deepEqual(res.body, { code: "API_KEY_SCOPE_DENIED", message: "sem escopo" });
});

test("429 traz o retry_after do header", async () => {
	const { fetch } = stubFetch({ status: 429, body: { code: "RATE_LIMIT_EXCEEDED" }, headers: { "retry-after": "30" } });
	const res = await new VertraClient("k", { fetch }).get("/v1/apps");

	assert.deepEqual(res.body, { code: "RATE_LIMIT_EXCEEDED", message: undefined, retry_after: 30 });
});

test("falha de rede vira NETWORK_ERROR", async () => {
	const fetch = (async () => {
		throw new Error("getaddrinfo ENOTFOUND");
	}) as typeof globalThis.fetch;
	const res = await new VertraClient("k", { fetch }).get("/v1/apps");

	assert.equal(res.ok, false);
	assert.equal((res.body as { code: string }).code, "NETWORK_ERROR");
});

test("baseUrl alternativo é respeitado e a query é montada", async () => {
	const { fetch, calls } = stubFetch({ body: {} });
	await new VertraClient("k", { fetch, baseUrl: "http://localhost:3000/" }).get("/v1/apps/1/metrics", {
		range: "24h",
		workspace_id: undefined,
	});

	assert.equal(calls[0]?.url, "http://localhost:3000/v1/apps/1/metrics?range=24h");
});

test("não segue redirect: 302 falha com mensagem clara e o destino nunca recebe a requisição", async () => {
	const { createServer } = await import("node:http");
	let targetHits = 0;
	const target = createServer((_req, res) => {
		targetHits++;
		res.end("{}");
	});
	await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
	const targetPort = (target.address() as { port: number }).port;
	const origin = createServer((_req, res) => {
		res.writeHead(302, { Location: `http://127.0.0.1:${targetPort}/steal` });
		res.end();
	});
	await new Promise<void>((r) => origin.listen(0, "127.0.0.1", r));
	const originPort = (origin.address() as { port: number }).port;
	try {
		const res = await new VertraClient("k", { baseUrl: `http://127.0.0.1:${originPort}` }).get("/v1/apps");
		assert.equal(res.ok, false);
		const body = res.body as { code: string; message: string };
		assert.equal(body.code, "UNEXPECTED_REDIRECT");
		assert.match(body.message, /redirect/i);
		assert.equal(targetHits, 0);
	} finally {
		origin.close();
		target.close();
	}
});
