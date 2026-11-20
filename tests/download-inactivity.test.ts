import assert from "node:assert/strict";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, test } from "vitest";
import { VertraClient } from "../src/client.js";
import { tools } from "../src/tools/index.js";

let server: Server | undefined;
afterEach(async () => {
	server?.closeAllConnections();
	await new Promise((resolve) => server?.close(resolve));
	server = undefined;
});

async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
	server = createServer(handler);
	await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
	return `http://127.0.0.1:${(server?.address() as AddressInfo).port}`;
}

const CHUNKS = 14;
const CHUNK_EVERY_MS = 100;

/** Sends `CHUNKS` chunks, one every 100 ms (1.4 s in all), then ends. */
const slowButAlive: Parameters<typeof createServer>[1] = (_req, res) => {
	res.writeHead(200, { "content-type": "application/zip" });
	let sent = 0;
	const timer = setInterval(() => {
		res.write(Buffer.alloc(10, sent));
		if (++sent === CHUNKS) {
			clearInterval(timer);
			res.end();
		}
	}, CHUNK_EVERY_MS);
	res.on("close", () => clearInterval(timer));
};

/** Sends one chunk and then goes silent without closing the connection. */
const stalls: Parameters<typeof createServer>[1] = (_req, res) => {
	res.writeHead(200, { "content-type": "application/zip" });
	res.write(Buffer.alloc(10, 1));
};

test("download lento, mas que continua chegando, termina: o prazo é de inatividade, não total", async () => {
	const baseUrl = await listen(slowButAlive);
	const client = new VertraClient("k", { baseUrl, downloadInactivityMs: 400 });
	const started = Date.now();
	const res = await client.download("/v1/users/a1/snapshots/s1/download", { scope: "applications" });
	assert.equal(res.ok, true);
	assert.equal((res.body as Uint8Array).length, CHUNKS * 10);
	assert.ok(Date.now() - started > 1000, "o servidor falso deveria levar mais de 1 s");
});

test("download que para no meio estoura por inatividade, com erro claro", async () => {
	const baseUrl = await listen(stalls);
	const client = new VertraClient("k", { baseUrl, downloadInactivityMs: 300 });
	const started = Date.now();
	const res = await client.download("/v1/users/a1/snapshots/s1/download", { scope: "applications" });
	assert.equal(res.ok, false);
	const body = res.body as { code: string; message?: string };
	assert.equal(body.code, "TIMEOUT");
	assert.match(body.message ?? "", /no data/i);
	assert.ok(Date.now() - started < 3000);
});

test("download_snapshot usa o mesmo prazo de inatividade e grava o arquivo inteiro", async () => {
	const baseUrl = await listen(slowButAlive);
	const { mkdtempSync, readFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const root = mkdtempSync(join(tmpdir(), "vertra-mcp-"));
	process.env.VERTRA_MCP_ROOT = root;
	const tool = tools.find((t) => t.name === "download_snapshot");
	assert.ok(tool);
	const result = await tool.handler({ scope: "applications", resource_id: "a1", snapshot_id: "s1", dest: "out.zip" }, new VertraClient("k", { baseUrl, downloadInactivityMs: 400 }));
	assert.notEqual(result.isError, true);
	assert.equal(readFileSync(join(root, "out.zip")).length, CHUNKS * 10);
});

test("a leitura binária não põe teto total de tempo no corpo (nenhum AbortSignal.timeout longo)", async () => {
	const baseUrl = await listen(slowButAlive);
	const spy: number[] = [];
	const original = AbortSignal.timeout;
	AbortSignal.timeout = (ms: number) => {
		spy.push(ms);
		return original.call(AbortSignal, ms);
	};
	try {
		await new VertraClient("k", { baseUrl, downloadInactivityMs: 400 }).download("/v1/users/a1/snapshots/s1/download", { scope: "applications" });
	} finally {
		AbortSignal.timeout = original;
	}
	assert.deepEqual(spy, []);
});

test("o signal do chamador continua cancelando o download", async () => {
	const baseUrl = await listen(slowButAlive);
	const controller = new AbortController();
	setTimeout(() => controller.abort(), 250);
	const res = await new VertraClient("k", { baseUrl, downloadInactivityMs: 5_000 }).request({
		method: "GET",
		path: "/v1/users/a1/snapshots/s1/download",
		query: { scope: "applications" },
		binary: true,
		signal: controller.signal,
	});
	assert.equal(res.ok, false);
	assert.equal((res.body as { code: string }).code, "ABORTED");
});

test("429 RESTORE_COOLDOWN traz retry_after de details", async () => {
	const baseUrl = await listen((_req, res) => {
		res.writeHead(429, { "content-type": "application/json" });
		res.end(JSON.stringify({ code: "RESTORE_COOLDOWN", details: { retry_after: 42 } }));
	});
	const res = await new VertraClient("k", { baseUrl }).post("/v1/users/a1/snapshots/s1/restore");
	assert.equal((res.body as { retry_after?: number }).retry_after, 42);
});
