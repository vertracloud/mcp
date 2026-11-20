import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "vitest";
import { type ZodTypeAny, z } from "zod";
import { VertraClient } from "../src/client.js";
import { toolScope, tools } from "../src/tools/index.js";
import { parseResult, stubFetch } from "./helpers.js";

function tool(name: string) {
	const found = tools.find((t) => t.name === name);
	if (!found) throw new Error(`tool ${name} not found`);
	return found;
}

const job = (status: string, extra: Record<string, unknown> = {}) => ({ response: { id: "j1", kind: "restore", resource_id: "a1", type: 1, status, ...extra } });

let root: string;
const previous = process.env.VERTRA_MCP_ROOT;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "vertra-mcp-"));
	process.env.VERTRA_MCP_ROOT = root;
});
afterEach(() => {
	process.env.VERTRA_MCP_ROOT = previous ?? "";
});

test("restore_snapshot devolve o job_id com texto claro e o warning", async () => {
	const { fetch } = stubFetch({ status: 202, body: { response: { job_id: "j9", warning: "IMAGE_VERSION_NOT_FOUND" } } });
	const parsed = parseResult(await tool("restore_snapshot").handler({ scope: "applications", resource_id: "a1", snapshot_id: "s1" }, new VertraClient("k", { fetch }))) as {
		job_id: string;
		warning: string;
		message: string;
	};
	assert.equal(parsed.job_id, "j9");
	assert.equal(parsed.warning, "IMAGE_VERSION_NOT_FOUND");
	assert.match(parsed.message, /get_snapshot_job/);
});

test("restore_snapshot sem warning devolve o job direto", async () => {
	const { fetch } = stubFetch({ status: 202, body: { response: { job_id: "j9" } } });
	const parsed = parseResult(await tool("restore_snapshot").handler({ scope: "databases", resource_id: "d1", snapshot_id: "s1" }, new VertraClient("k", { fetch }))) as Record<string, unknown>;
	assert.equal(parsed.job_id, "j9");
	assert.equal("warning" in parsed, false);
});

test("restore_snapshot: 400 SNAPSHOT_EXCEEDS_STORAGE chega com details intactos", async () => {
	const details = { required_bytes: 900, available_bytes: 100, required_ram_mb: 512 };
	const { fetch } = stubFetch({ status: 400, body: { code: "SNAPSHOT_EXCEEDS_STORAGE", details } });
	const result = await tool("restore_snapshot").handler({ scope: "databases", resource_id: "d1", snapshot_id: "s1" }, new VertraClient("k", { fetch }));
	assert.equal(result.isError, true);
	assert.deepEqual((parseResult(result) as { details: unknown }).details, details);
});

test("get_snapshot_job lê o job na rota do recurso, com o scope, e explica o estado", async () => {
	const { fetch, calls } = stubFetch({ body: job("running") });
	const parsed = parseResult(await tool("get_snapshot_job").handler({ scope: "applications", resource_id: "a1", job_id: "j1" }, new VertraClient("k", { fetch }))) as { status: string; message: string };
	const url = new URL(calls[0]?.url ?? "");
	assert.equal(url.pathname, "/v1/users/a1/snapshots/jobs/j1");
	assert.equal(url.searchParams.get("scope"), "applications");
	assert.equal(parsed.status, "running");
	assert.match(parsed.message, /again/);
});

test("get_snapshot_job devolve o progress do job em andamento e o resume na mensagem", async () => {
	const progress = { phase: "copying", percent: 42.4, done_bytes: 1073741824, total_bytes: 2147483648, eta_seconds: 185 };
	const { fetch } = stubFetch({ body: job("running", { progress }) });
	const parsed = parseResult(await tool("get_snapshot_job").handler({ scope: "applications", resource_id: "a1", job_id: "j1" }, new VertraClient("k", { fetch }))) as { progress: unknown; message: string };
	assert.deepEqual(parsed.progress, progress);
	assert.match(parsed.message, /copying, 42%, 1\.0 GiB of 2\.0 GiB, about 3 min left/);
});

test("get_snapshot_job com progress sem total nem percentual (banco) mostra só a fase e os bytes", async () => {
	const { fetch } = stubFetch({ body: job("running", { progress: { phase: "copying", done_bytes: 5242880 } }) });
	const parsed = parseResult(await tool("get_snapshot_job").handler({ scope: "databases", resource_id: "d1", job_id: "j1" }, new VertraClient("k", { fetch }))) as { message: string };
	assert.match(parsed.message, /\(copying, 5\.0 MiB\)/);
});

test("get_snapshot_job com wait_seconds espera o fim do job", async () => {
	const { fetch, calls } = stubFetch([{ body: job("queued") }, { body: job("ready") }]);
	const parsed = parseResult(await tool("get_snapshot_job").handler({ scope: "applications", resource_id: "a1", job_id: "j1", wait_seconds: 10 }, new VertraClient("k", { fetch }))) as { status: string };
	assert.equal(parsed.status, "ready");
	assert.equal(calls.length, 2);
});

test("get_snapshot_job devolve o motivo quando o job falhou", async () => {
	const { fetch } = stubFetch({ body: job("failed", { reason: "SNAPSHOT_IMPORT_FAILED" }) });
	const parsed = parseResult(await tool("get_snapshot_job").handler({ scope: "databases", resource_id: "d1", job_id: "j1" }, new VertraClient("k", { fetch }))) as { reason: string; message: string };
	assert.equal(parsed.reason, "SNAPSHOT_IMPORT_FAILED");
	assert.match(parsed.message, /FAILED with SNAPSHOT_IMPORT_FAILED/);
});

test("get_snapshot_job devolve os details do motivo no job e na mensagem", async () => {
	const details = { required_bytes: 900, available_bytes: 100, required_ram_mb: 512 };
	const { fetch } = stubFetch({ body: job("failed", { reason: "SNAPSHOT_EXCEEDS_STORAGE", details }) });
	const parsed = parseResult(await tool("get_snapshot_job").handler({ scope: "databases", resource_id: "d1", job_id: "j1" }, new VertraClient("k", { fetch }))) as { details: unknown; message: string };
	assert.deepEqual(parsed.details, details);
	assert.match(parsed.message, /required_ram_mb/);
});

test("get_snapshot_job exige job_id e deixa o scope opcional", () => {
	const shape = tool("get_snapshot_job").inputSchema as Record<string, ZodTypeAny>;
	assert.equal(shape.job_id?.isOptional(), false);
	assert.equal(shape.scope?.isOptional(), true);
	assert.equal("kind" in shape || "limit" in shape, false);
});

test("get_snapshot_job sem scope não manda scope na query", async () => {
	const { fetch, calls } = stubFetch({ body: job("ready") });
	await tool("get_snapshot_job").handler({ resource_id: "a1", job_id: "j1" }, new VertraClient("k", { fetch }));
	const url = new URL(calls[0]?.url ?? "");
	assert.equal(url.pathname, "/v1/users/a1/snapshots/jobs/j1");
	assert.equal(url.searchParams.has("scope"), false);
});

test("list_snapshot_jobs lista os jobs recentes do recurso, com kind e limit", async () => {
	const { fetch, calls } = stubFetch({ body: { response: [{ id: "j1" }] } });
	const parsed = parseResult(await tool("list_snapshot_jobs").handler({ scope: "databases", resource_id: "d1", kind: "restore", limit: 3 }, new VertraClient("k", { fetch })));
	const url = new URL(calls[0]?.url ?? "");
	assert.equal(url.pathname, "/v1/users/d1/snapshots/jobs");
	assert.equal(url.searchParams.get("scope"), "databases");
	assert.equal(url.searchParams.get("kind"), "restore");
	assert.equal(url.searchParams.get("limit"), "3");
	assert.deepEqual(parsed, [{ id: "j1" }]);
});

test("list_snapshot_jobs: limit de 1 a 50 e escopo snapshots:read, somente leitura", () => {
	const t = tool("list_snapshot_jobs");
	const schema = z.object(t.inputSchema as Record<string, ZodTypeAny>);
	assert.equal(schema.safeParse({ scope: "applications", resource_id: "a1", limit: 50 }).success, true);
	assert.equal(schema.safeParse({ scope: "applications", resource_id: "a1", limit: 51 }).success, false);
	assert.equal(schema.safeParse({ scope: "applications", resource_id: "a1", limit: 0 }).success, false);
	assert.equal(schema.safeParse({ resource_id: "a1" }).success, false);
	assert.equal(toolScope(t), "snapshots:read");
	assert.equal(t.annotations.readOnlyHint, true);
});

test("get_snapshot_job exige o escopo snapshots:read", () => {
	assert.equal(tool("get_snapshot_job").scope, "snapshots:read");
	assert.equal(tool("get_snapshot_job").annotations.readOnlyHint, true);
});

const ZIP = new Uint8Array([80, 75, 3, 4]);
const snapshotPath = (url: string | undefined) => new URL(url ?? "").pathname;

test("download_app cria o snapshot manual e baixa o zip dele (201)", async () => {
	const { fetch, calls } = stubFetch([{ status: 201, body: { response: { id: "s9" } } }, { binary: ZIP }]);
	const result = await tool("download_app").handler({ id: "a1", dest: "out.zip" }, new VertraClient("k", { fetch }));
	assert.notEqual(result.isError, true);
	assert.equal(calls[0]?.method, "POST");
	assert.equal(snapshotPath(calls[0]?.url), "/v1/users/a1/snapshots");
	assert.equal(new URL(calls[0]?.url ?? "").searchParams.get("scope"), "applications");
	assert.equal(calls[1]?.method, "GET");
	assert.equal(snapshotPath(calls[1]?.url), "/v1/users/a1/snapshots/s9/download");
	assert.equal(new URL(calls[1]?.url ?? "").searchParams.get("scope"), "applications");
	assert.equal(readFileSync(join(root, "out.zip")).length, 4);
	assert.equal(calls.some((c) => c.url.includes("/v1/apps/")), false);
});

test("download_app com 202 espera o job ficar ready e baixa o snapshot do job", async () => {
	const { fetch, calls } = stubFetch([
		{ status: 202, body: { response: { job_id: "j1" } } },
		{ body: { response: { id: "j1", status: "running" } } },
		{ body: { response: { id: "j1", status: "ready", snapshot_id: "s8" } } },
		{ binary: ZIP },
	]);
	const result = await tool("download_app").handler({ id: "a1", dest: "out.zip", wait_seconds: 10 }, new VertraClient("k", { fetch }));
	assert.notEqual(result.isError, true);
	assert.equal(snapshotPath(calls[1]?.url), "/v1/users/a1/snapshots/jobs/j1");
	assert.equal(snapshotPath(calls[3]?.url), "/v1/users/a1/snapshots/s8/download");
	assert.equal(readFileSync(join(root, "out.zip")).length, 4);
});

test("download_app: se a espera acaba, responde 'accepted' com o job_id e não grava nada", async () => {
	const { fetch } = stubFetch([{ status: 202, body: { response: { job_id: "j1" } } }, { body: { response: { id: "j1", status: "running" } } }]);
	const result = await tool("download_app").handler({ id: "a1", dest: "out.zip", wait_seconds: 1 }, new VertraClient("k", { fetch }));
	assert.notEqual(result.isError, true);
	const parsed = parseResult(result) as { status: string; job_id: string; message: string };
	assert.equal(parsed.status, "accepted");
	assert.equal(parsed.job_id, "j1");
	assert.match(parsed.message, /get_snapshot_job/);
	assert.match(parsed.message, /download_snapshot/);
	assert.equal(existsSync(join(root, "out.zip")), false);
});

test("download_app: job que termina failed vira erro com o motivo", async () => {
	const { fetch } = stubFetch([
		{ status: 202, body: { response: { job_id: "j1" } } },
		{ body: { response: { id: "j1", status: "failed", reason: "SNAPSHOT_TOO_LARGE", details: { max_bytes: 10 } } } },
	]);
	const result = await tool("download_app").handler({ id: "a1", dest: "out.zip" }, new VertraClient("k", { fetch }));
	assert.equal(result.isError, true);
	const parsed = parseResult(result) as { code: string; details: unknown };
	assert.equal(parsed.code, "SNAPSHOT_TOO_LARGE");
	assert.deepEqual(parsed.details, { max_bytes: 10 });
});

test("download_app: erro ao criar o snapshot chega intacto (cota, plano)", async () => {
	const { fetch, calls } = stubFetch({ status: 429, body: { code: "SNAPSHOT_RATE_LIMITED", details: { scope: "account", retry_after: 5 } } });
	const result = await tool("download_app").handler({ id: "a1", dest: "out.zip" }, new VertraClient("k", { fetch }));
	assert.equal(result.isError, true);
	assert.equal((parseResult(result) as { code: string }).code, "SNAPSHOT_RATE_LIMITED");
	assert.equal(calls.length, 1);
});

test("download_app: sem download_id/workspace_id, escopo snapshots:write e a descrição pede também snapshots:read", () => {
	const t = tool("download_app");
	const shape = t.inputSchema as Record<string, ZodTypeAny>;
	assert.equal("download_id" in shape, false);
	assert.equal(toolScope(t), "snapshots:write");
	assert.match(t.description, /snapshots:write/);
	assert.match(t.description, /snapshots:read/);
	assert.doesNotMatch(t.description, /download_id|processing/);
});

test("create_database com snapshot_id manda o campo e devolve restore_job_id", async () => {
	const { fetch, calls } = stubFetch({ status: 202, body: { response: { id: "d2", restore_job_id: "j5" } } });
	const parsed = parseResult(await tool("create_database").handler({ engine: "postgresql", name: "n", ram: 512, snapshot_id: "s1" }, new VertraClient("k", { fetch }))) as { restore_job_id: string };
	assert.equal((JSON.parse(String(calls[0]?.body)) as { snapshot_id: string }).snapshot_id, "s1");
	assert.equal(parsed.restore_job_id, "j5");
});

test("create_app com snapshot_id não pede pasta, manda o snapshot e devolve restore_job_id", async () => {
	const { fetch, calls } = stubFetch({ status: 202, body: { response: { id: "a2", status: "down", restore_job_id: "j6" } } });
	const parsed = parseResult(await tool("create_app").handler({ name: "n", snapshot_id: "s1" }, new VertraClient("k", { fetch }))) as { restore_job_id: string };
	const form = calls[0]?.body as FormData;
	assert.equal(form.get("snapshot_id"), "s1");
	assert.equal(form.has("file"), false);
	assert.equal(parsed.restore_job_id, "j6");
});

test("create_app recusa path junto com snapshot_id e a falta de path sem snapshot_id", async () => {
	const { fetch, calls } = stubFetch({});
	const client = new VertraClient("k", { fetch });
	const both = await tool("create_app").handler({ name: "n", path: ".", snapshot_id: "s1", memory: 256, main: "a.js" }, client);
	assert.equal((parseResult(both) as { code: string }).code, "INVALID_ARGUMENTS");
	const neither = await tool("create_app").handler({ name: "n" }, client);
	assert.equal((parseResult(neither) as { code: string }).code, "INVALID_ARGUMENTS");
	assert.equal(calls.length, 0);
});

test("create_snapshot com 202 devolve o job_id e manda usar get_snapshot_job, sem erro", async () => {
	const { fetch } = stubFetch({ status: 202, body: { response: { job_id: "j7" } } });
	const result = await tool("create_snapshot").handler({ scope: "databases", resource_id: "d1" }, new VertraClient("k", { fetch }));
	assert.notEqual(result.isError, true);
	const parsed = parseResult(result) as { status: string; job_id: string; message: string };
	assert.equal(parsed.status, "accepted");
	assert.equal(parsed.job_id, "j7");
	assert.match(parsed.message, /get_snapshot_job/);
});

test("create_snapshot com 201 devolve o snapshot como antes", async () => {
	const { fetch } = stubFetch({ status: 201, body: { response: { id: "s1" } } });
	const parsed = parseResult(await tool("create_snapshot").handler({ scope: "applications", resource_id: "a1" }, new VertraClient("k", { fetch })));
	assert.deepEqual(parsed, { id: "s1" });
});

test("create_snapshot com 202 sem job_id é erro", async () => {
	const { fetch } = stubFetch({ status: 202, body: { response: {} } });
	const result = await tool("create_snapshot").handler({ scope: "applications", resource_id: "a1" }, new VertraClient("k", { fetch }));
	assert.equal(result.isError, true);
});

const WS = "33333333-3333-3333-3333-333333333333";

test("workspace_id vai em todas as chamadas do fluxo de download_app (snapshot, job, download)", async () => {
	const { fetch, calls } = stubFetch([
		{ status: 202, body: { response: { job_id: "j1" } } },
		{ body: { response: { id: "j1", status: "ready", snapshot_id: "s8" } } },
		{ binary: ZIP },
	]);
	const result = await tool("download_app").handler({ id: "a1", dest: "ws.zip", workspace_id: WS }, new VertraClient("k", { fetch }));
	assert.notEqual(result.isError, true);
	assert.equal(calls.length, 3);
	for (const call of calls) assert.equal(new URL(call.url).searchParams.get("workspace_id"), WS, call.url);
});

test("as ferramentas de snapshot repassam workspace_id e não o mandam quando ausente", async () => {
	const cases: [string, Record<string, unknown>][] = [
		["list_snapshots", { scope: "applications", resource_id: "a1" }],
		["create_snapshot", { scope: "applications", resource_id: "a1" }],
		["restore_snapshot", { scope: "applications", resource_id: "a1", snapshot_id: "s1" }],
		["get_snapshot_job", { resource_id: "a1", job_id: "j1" }],
		["list_snapshot_jobs", { scope: "applications", resource_id: "a1" }],
		["download_snapshot", { scope: "applications", resource_id: "a1", snapshot_id: "s1", dest: "d.zip" }],
	];
	for (const [name, args] of cases) {
		const withWs = stubFetch({ status: 200, body: { response: { id: "j1", status: "ready" } }, binary: undefined });
		await tool(name).handler({ ...args, workspace_id: WS }, new VertraClient("k", { fetch: withWs.fetch }));
		assert.equal(new URL(withWs.calls[0]?.url ?? "").searchParams.get("workspace_id"), WS, name);
		const without = stubFetch({ status: 200, body: { response: { id: "j1", status: "ready" } } });
		await tool(name).handler({ ...args, dest: `x-${name}.zip` }, new VertraClient("k", { fetch: without.fetch }));
		assert.equal(new URL(without.calls[0]?.url ?? "").searchParams.has("workspace_id"), false, name);
	}
});
