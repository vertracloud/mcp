// O2 (QA E1): `deploy_template` espera DE FATO até `wait_seconds` (padrão 45, máximo 110) antes de devolver o job em andamento. Servidor HTTP falso de verdade (o
// `fetch` real do cliente), job que só termina no fim; mede o tempo e as consultas.
import assert from "node:assert/strict";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, test } from "vitest";
import { z } from "zod";
import { VertraClient } from "../src/client.js";
import { toolScope, tools } from "../src/tools/index.js";
import { pollOptions } from "../src/tools/templates.js";
import { parseResult } from "./helpers.js";

const deploy = tools.find((t) => t.name === "deploy_template")!;
let server: Server;
let reads = 0;
let finishAfterReads = Number.POSITIVE_INFINITY;

const reply = (res: ServerResponse, status: number, body: unknown) => {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
};
const job = (status: string) => ({ response: { id: "j1", kind: "deploy", status, steps: [], outputs: [] } });

beforeEach(async () => {
	reads = 0;
	finishAfterReads = Number.POSITIVE_INFINITY;
	server = createServer((req: IncomingMessage, res: ServerResponse) => {
		if (req.method === "POST") return reply(res, 202, job("running"));
		reads++;
		return reply(res, 200, job(reads >= finishAfterReads ? "succeeded" : "running"));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});
afterEach(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

const clientOf = () => new VertraClient("k", { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
const run = async (args: Record<string, unknown>) => {
	const started = Date.now();
	const out = parseResult(await deploy.handler({ id: "n8n", name: "x", ...args }, clientOf())) as Record<string, any>;
	return { out, elapsed: Date.now() - started };
};

test("espera até `wait_seconds` antes de devolver `running`, consultando o job a cada intervalo", async () => {
	pollOptions.intervalMs = 150;
	const { out, elapsed } = await run({ wait_seconds: 2 });
	assert.ok(elapsed >= 1900, `devolveu cedo demais: ${elapsed} ms`);
	assert.ok(elapsed < 4000, `passou do prazo: ${elapsed} ms`);
	assert.ok(reads >= 8, `consultou pouco: ${reads}`);
	assert.equal(out.status, "running");
	assert.match(String(out.note), /get_template_deploy/);
	assert.match(String(out.note), /2s/);
});

test("sem `wait_seconds` vale o padrão (a nota diz quanto esperou)", async () => {
	pollOptions.intervalMs = 100;
	pollOptions.defaultWaitSeconds = 1;
	const { out, elapsed } = await run({});
	assert.ok(elapsed >= 900, `devolveu cedo demais: ${elapsed} ms`);
	assert.match(String(out.note), /1s/);
});

test("termina antes do prazo quando o job conclui", async () => {
	pollOptions.intervalMs = 100;
	finishAfterReads = 3;
	const { out, elapsed } = await run({ wait_seconds: 30 });
	assert.equal(out.status, "succeeded");
	assert.ok(elapsed < 2000, `esperou à toa: ${elapsed} ms`);
});

test("`wait_seconds: 0` devolve na hora; `wait: false` nem consulta", async () => {
	pollOptions.intervalMs = 100;
	const zero = await run({ wait_seconds: 0 });
	assert.equal(zero.out.status, "running");
	assert.ok(zero.elapsed < 1000);
	reads = 0;
	const noWait = await run({ wait: false });
	assert.equal(noWait.out.status, "running");
	assert.equal(reads, 0);
});

test("o prazo respeita o máximo de 110 s e o schema recusa mais que isso", () => {
	const schema = z.object(deploy.inputSchema as z.ZodRawShape);
	assert.equal(schema.safeParse({ id: "n8n", name: "x", wait_seconds: 110 }).success, true);
	assert.equal(schema.safeParse({ id: "n8n", name: "x", wait_seconds: 111 }).success, false);
	assert.match(deploy.description, /wait_seconds/);
	assert.equal(toolScope(deploy), "templates:deploy");
});
