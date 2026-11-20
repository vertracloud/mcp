import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";
import { VertraClient } from "../src/client.js";
import { tools } from "../src/tools/index.js";

const MB = 1024 * 1024;

let server: Server | undefined;
afterEach(async () => {
	if (!server) return;
	server.closeAllConnections();
	await new Promise((resolve) => server?.close(resolve));
	server = undefined;
});

async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
	server = createServer(handler);
	await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
	return `http://127.0.0.1:${(server?.address() as AddressInfo).port}`;
}

function newRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "vertra-mcp-dl-"));
	process.env.VERTRA_MCP_ROOT = root;
	return root;
}

const tool = (name: string) => {
	const found = tools.find((t) => t.name === name);
	assert.ok(found);
	return found;
};
const snapshotArgs = (dest: string) => ({ scope: "applications", resource_id: "a1", snapshot_id: "s1", dest });

async function sha256File(path: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
	return hash.digest("hex");
}

test("download_snapshot: 400 MB chegam ao disco com memória constante, antes do fim da resposta, e o arquivo sai idêntico", async () => {
	const total = 400;
	const root = newRoot();
	const expected = createHash("sha256");
	let midSize = 0;
	let finalNameBeforeEnd = false;
	const baseUrl = await listen(async (_req, res) => {
		res.writeHead(200, { "content-type": "application/zip" });
		for (let i = 0; i < total; i++) {
			const chunk = Buffer.alloc(MB, i % 251);
			expected.update(chunk);
			if (!res.write(chunk)) await new Promise((resolve) => res.once("drain", resolve));
			if (i === total / 2) {
				await new Promise((resolve) => setTimeout(resolve, 200));
				const part = readdirSync(root).find((name) => name.endsWith(".part"));
				if (part) midSize = statSync(join(root, part)).size;
				finalNameBeforeEnd = existsSync(join(root, "out.zip"));
			}
		}
		res.end();
	});
	const base = process.memoryUsage().rss;
	let peak = 0;
	const sampler = setInterval(() => {
		peak = Math.max(peak, process.memoryUsage().rss - base);
	}, 20);
	const result = await tool("download_snapshot").handler(snapshotArgs("out.zip"), new VertraClient("k", { baseUrl }));
	clearInterval(sampler);
	assert.notEqual(result.isError, true, result.content[0]?.text);
	assert.equal((JSON.parse(result.content[0]?.text ?? "{}") as { bytes: number }).bytes, total * MB);
	assert.ok(midSize >= 100 * MB, `o temporário tinha ${midSize} bytes na metade da resposta`);
	assert.equal(finalNameBeforeEnd, false);
	assert.ok(peak < 160 * MB, `RSS cresceu ${Math.round(peak / MB)} MB para um arquivo de ${total} MB`);
	assert.equal(statSync(join(root, "out.zip")).size, total * MB);
	assert.equal(await sha256File(join(root, "out.zip")), expected.digest("hex"));
	assert.deepEqual(readdirSync(root), ["out.zip"]);
}, 60_000);

test("download que para no meio estoura por inatividade e não deixa arquivo nenhum", async () => {
	const root = newRoot();
	const baseUrl = await listen((_req, res) => {
		res.writeHead(200, { "content-type": "application/zip" });
		res.write(Buffer.alloc(1024, 1));
	});
	const result = await tool("download_snapshot").handler(snapshotArgs("out.zip"), new VertraClient("k", { baseUrl, downloadInactivityMs: 250 }));
	assert.equal(result.isError, true);
	assert.match(result.content[0]?.text ?? "", /TIMEOUT/);
	assert.deepEqual(readdirSync(root), []);
});

test("o signal do chamador cancela e remove o temporário", async () => {
	const root = newRoot();
	const baseUrl = await listen((_req, res) => {
		res.writeHead(200, { "content-type": "application/zip" });
		const timer = setInterval(() => res.write(Buffer.alloc(1024)), 20);
		res.on("close", () => clearInterval(timer));
	});
	const { openLocalDestination } = await import("../src/local.js");
	const target = await openLocalDestination("out.zip");
	const controller = new AbortController();
	setTimeout(() => controller.abort(), 200);
	const res = await new VertraClient("k", { baseUrl, downloadInactivityMs: 5_000 }).downloadInto("/v1/users/a1/snapshots/s1/download", { scope: "applications" }, target, controller.signal);
	assert.equal(res.ok, false);
	assert.equal((res.body as { code: string }).code, "ABORTED");
	await target.abort();
	assert.deepEqual(readdirSync(root), []);
});

test("erro da API (404) não cria arquivo", async () => {
	const root = newRoot();
	const baseUrl = await listen((_req, res) => {
		res.writeHead(404, { "content-type": "application/json" });
		res.end(JSON.stringify({ code: "SNAPSHOT_NOT_FOUND" }));
	});
	const result = await tool("download_snapshot").handler(snapshotArgs("out.zip"), new VertraClient("k", { baseUrl }));
	assert.equal(result.isError, true);
	assert.match(result.content[0]?.text ?? "", /SNAPSHOT_NOT_FOUND/);
	assert.deepEqual(readdirSync(root), []);
});

test("nunca sobrescreve: destino existente falha antes de baixar e fica intacto", async () => {
	const root = newRoot();
	writeFileSync(join(root, "out.zip"), "antigo");
	let requests = 0;
	const baseUrl = await listen((_req, res) => {
		requests++;
		res.writeHead(200);
		res.end("novo");
	});
	const result = await tool("download_snapshot").handler(snapshotArgs("out.zip"), new VertraClient("k", { baseUrl }));
	assert.equal(result.isError, true);
	assert.match(result.content[0]?.text ?? "", /DEST_EXISTS/);
	assert.equal(requests, 0);
	assert.equal(readFileSync(join(root, "out.zip"), "utf8"), "antigo");
});

test("destino que aparece durante o download não é sobrescrito no fim", async () => {
	const root = newRoot();
	const baseUrl = await listen(async (_req, res) => {
		res.writeHead(200);
		res.write("novo");
		writeFileSync(join(root, "out.zip"), "apareceu");
		await new Promise((resolve) => setTimeout(resolve, 50));
		res.end();
	});
	const result = await tool("download_snapshot").handler(snapshotArgs("out.zip"), new VertraClient("k", { baseUrl }));
	assert.equal(result.isError, true);
	assert.match(result.content[0]?.text ?? "", /DEST_EXISTS/);
	assert.equal(readFileSync(join(root, "out.zip"), "utf8"), "apareceu");
	assert.deepEqual(readdirSync(root), ["out.zip"]);
});

test("fora da raiz permitida é recusado", async () => {
	newRoot();
	const result = await tool("download_snapshot").handler(snapshotArgs("../fora.zip"), new VertraClient("k", { baseUrl: "http://127.0.0.1:1" }));
	assert.equal(result.isError, true);
	assert.match(result.content[0]?.text ?? "", /PATH_OUTSIDE_ROOT/);
});

test("download_app: destino existente falha antes de tirar o snapshot", async () => {
	const root = newRoot();
	writeFileSync(join(root, "app.zip"), "antigo");
	let requests = 0;
	const baseUrl = await listen((_req, res) => {
		requests++;
		res.writeHead(201, { "content-type": "application/json" });
		res.end(JSON.stringify({ response: { id: "s1" } }));
	});
	const result = await tool("download_app").handler({ id: "a1", dest: "app.zip" }, new VertraClient("k", { baseUrl }));
	assert.equal(result.isError, true);
	assert.match(result.content[0]?.text ?? "", /DEST_EXISTS/);
	assert.equal(requests, 0);
});

test("download_app: tira o snapshot e grava o zip em fluxo", async () => {
	const root = newRoot();
	const baseUrl = await listen((req, res) => {
		if (req.method === "POST") {
			res.writeHead(201, { "content-type": "application/json" });
			res.end(JSON.stringify({ response: { id: "s1" } }));
			return;
		}
		res.writeHead(200, { "content-type": "application/zip" });
		res.end("PK\u0003\u0004");
	});
	const result = await tool("download_app").handler({ id: "a1", dest: "app.zip" }, new VertraClient("k", { baseUrl }));
	assert.notEqual(result.isError, true, result.content[0]?.text);
	assert.equal(readFileSync(join(root, "app.zip")).length, 4);
	assert.deepEqual(readdirSync(root), ["app.zip"]);
});

test("download_snapshot: corpo cortado antes do Content-Length é erro e não deixa arquivo", async () => {
	const root = newRoot();
	const baseUrl = await listen((_req, res) => {
		res.writeHead(200, { "content-type": "application/zip", "content-length": String(4 * MB) });
		res.write(Buffer.alloc(2 * MB, 7), () => setTimeout(() => res.socket?.destroy(), 20));
	});
	const result = await tool("download_snapshot").handler(snapshotArgs("out.zip"), new VertraClient("k", { baseUrl }));
	assert.equal(result.isError, true);
	assert.deepEqual(readdirSync(root), []);
});
