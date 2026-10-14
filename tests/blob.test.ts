import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { afterEach, beforeEach, test } from "vitest";
import { VertraClient } from "../src/client.js";
import { LocalError, readLocalFile } from "../src/local.js";
import { MAX_SIMPLE_UPLOAD_BYTES } from "../src/tools/blob.js";
import { toolScope, tools } from "../src/tools/index.js";
import { parseResult, stubFetch } from "./helpers.js";

const tool = (name: string) => {
	const found = tools.find((t) => t.name === name);
	assert.ok(found, `tool ${name} não existe`);
	return found;
};

let root: string;
const previous = process.env.VERTRA_MCP_ROOT;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "vertra-mcp-blob-"));
	process.env.VERTRA_MCP_ROOT = root;
});

afterEach(() => {
	process.env.VERTRA_MCP_ROOT = previous ?? "";
});

test("cada tool de blob tem o escopo certo, derivado do catálogo", () => {
	const expected: Record<string, string> = {
		list_blob_objects: "blob:read",
		get_blob_object: "blob:read",
		upload_blob: "blob:write",
		delete_blob_object: "blob:write",
		blob_download_url: "blob:read",
		blob_stats: "blob:read",
		set_blob_visibility: "blob:write",
	};
	for (const [name, scope] of Object.entries(expected)) assert.equal(toolScope(tool(name)), scope, name);
});

test("listagem vai para o host de blob, com prefixo, delimitador e limite", async () => {
	const { fetch, calls } = stubFetch({ body: { response: { objects: [], folders: [], cursor: null } } });
	await tool("list_blob_objects").handler({ prefix: "fotos/", delimiter: "/", limit: 10 }, new VertraClient("k", { fetch }));
	assert.equal(calls[0]?.url, "https://blob.vertracloud.app/v1/objects?prefix=fotos%2F&delimiter=%2F&limit=10");
	assert.equal(calls[0]?.headers.Authorization, "Bearer k");
});

test("blobBaseUrl troca o host sem mexer no da API", async () => {
	const { fetch, calls } = stubFetch({ body: { response: {} } });
	const client = new VertraClient("k", { fetch, blobBaseUrl: "http://127.0.0.1:9/v1/" });
	await tool("blob_stats").handler({}, client);
	assert.equal(calls[0]?.url, "http://127.0.0.1:9/v1/stats");
});

test("id do agente é escapado na rota do blob e `..` é recusado", async () => {
	const { fetch, calls } = stubFetch({ body: { response: {} } });
	await tool("get_blob_object").handler({ id: "../stats" }, new VertraClient("k", { fetch }));
	assert.equal(calls[0]?.url, "https://blob.vertracloud.app/v1/objects/..%2Fstats");

	await assert.rejects(async () => tool("delete_blob_object").handler({ id: ".." }, new VertraClient("k", { fetch })));
	assert.equal(calls.length, 1);
});

test("link temporário pede resposta sem redirecionamento e o prazo", async () => {
	const reply = { url: "https://files.example.com/d/x", expires_at: "2026-10-14T12:00:00.000Z" };
	const { fetch, calls } = stubFetch({ body: { response: reply } });
	const result = await tool("blob_download_url").handler({ id: "9", expires_in: 600 }, new VertraClient("k", { fetch }));
	assert.equal(calls[0]?.url, "https://blob.vertracloud.app/v1/objects/9/download?expires_in=600&redirect=false");
	assert.deepEqual(parseResult(result), reply);
});

test("mudar visibilidade faz PATCH só com o campo informado", async () => {
	const { fetch, calls } = stubFetch({ body: { response: { id: "9", visibility: "public" } } });
	await tool("set_blob_visibility").handler({ id: "9", visibility: "public" }, new VertraClient("k", { fetch }));
	assert.equal(calls[0]?.method, "PATCH");
	assert.equal(calls[0]?.url, "https://blob.vertracloud.app/v1/objects/9");
	assert.deepEqual(JSON.parse(String(calls[0]?.body)), { visibility: "public" });
});

test("excluir objeto usa DELETE e aceita a resposta nula", async () => {
	const { fetch, calls } = stubFetch({ body: { response: null } });
	const result = await tool("delete_blob_object").handler({ id: "9" }, new VertraClient("k", { fetch }));
	assert.equal(calls[0]?.method, "DELETE");
	assert.deepEqual(parseResult(result), { ok: true });
});

test("erro da API do blob chega com o envelope intacto", async () => {
	const { fetch } = stubFetch({ status: 404, body: { code: "BLOB_OBJECT_NOT_FOUND" } });
	const result = await tool("get_blob_object").handler({ id: "1" }, new VertraClient("k", { fetch }));
	assert.equal(result.isError, true);
	assert.deepEqual(parseResult(result), { code: "BLOB_OBJECT_NOT_FOUND" });
});

test("upload_blob envia o arquivo do disco como multipart, privado por padrão", async () => {
	writeFileSync(join(root, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
	const { fetch, calls } = stubFetch({ body: { response: { id: "1", path: "logo.png" } } });
	const result = await tool("upload_blob").handler({ file: "logo.png" }, new VertraClient("k", { fetch }));

	assert.equal(result.isError, undefined);
	assert.equal(calls[0]?.method, "POST");
	assert.equal(calls[0]?.url, "https://blob.vertracloud.app/v1/objects?path=logo.png&visibility=private&overwrite=false");
	const form = calls[0]?.body as FormData;
	assert.ok(form instanceof FormData);
	const sent = form.get("file") as File;
	assert.equal(sent.name, "logo.png");
	assert.equal(sent.size, 4);
});

test("upload_blob recusa arquivo sensível pelo nome, sem tocar na rede", async () => {
	mkdirSync(join(root, ".git"));
	mkdirSync(join(root, "app"));
	mkdirSync(join(root, "app", ".GIT"));
	const names = [".env", ".env.production", "server.pem", "tls.key", "id_rsa", "id_rsa.pub", "id_ed25519", "cert.p12", "cert.pfx", ".npmrc", ".netrc", "credentials", ".git/config", "app/.ENV", ".git-credentials", ".pgpass", ".pypirc", ".htpasswd", ".dockercfg", ".vault-token", ".my.cnf", ".s3cfg", "terraform.tfstate", "prod.tfvars", "service-account.json", "kubeconfig", "id_ecdsa", "id_dsa", "release.jks", "vault.kdbx", "secrets.yaml", "app/.GIT/HEAD"];
	for (const name of names) writeFileSync(join(root, name), "x");
	const { fetch, calls } = stubFetch({ body: {} });
	for (const name of names) {
		const result = await tool("upload_blob").handler({ file: name }, new VertraClient("k", { fetch }));
		assert.equal(result.isError, true, name);
		assert.equal((parseResult(result) as { code: string }).code, "SENSITIVE_FILE", name);
	}
	assert.equal(calls.length, 0);

	writeFileSync(join(root, "keyboard.png"), "x");
	const ok = await tool("upload_blob").handler({ file: "keyboard.png" }, new VertraClient("k", { fetch: stubFetch({ body: { response: {} } }).fetch }));
	assert.equal(ok.isError, undefined);
});

test("delimiter só aceita \"/\"", () => {
	const schema = z.object(tool("list_blob_objects").inputSchema as z.ZodRawShape);
	assert.ok(schema.safeParse({ delimiter: "/" }).success);
	assert.ok(!schema.safeParse({ delimiter: "-" }).success);
});

test("upload_blob recusa arquivo fora da raiz sem tocar na rede", async () => {
	const { fetch, calls } = stubFetch({ body: {} });
	const result = await tool("upload_blob").handler({ file: "/etc/hosts" }, new VertraClient("k", { fetch }));
	assert.equal(result.isError, true);
	assert.equal((parseResult(result) as { code: string }).code, "PATH_OUTSIDE_ROOT");
	assert.equal(calls.length, 0);
});

test("readLocalFile recusa arquivo acima do limite e symlink", () => {
	writeFileSync(join(root, "grande.bin"), Buffer.alloc(10));
	assert.throws(() => readLocalFile("grande.bin", 5), (err: LocalError) => err.code === "FILE_TOO_LARGE");
	assert.equal(readLocalFile("grande.bin", 10).bytes.length, 10);

	symlinkSync(join(root, "grande.bin"), join(root, "atalho.bin"));
	assert.throws(() => readLocalFile("atalho.bin", 100), (err: LocalError) => err.code === "NOT_A_FILE");
});

test("o limite de envio simples é 100 MB", () => {
	assert.equal(MAX_SIMPLE_UPLOAD_BYTES, 100 * 1024 * 1024);
});

test("upload_blob recusa arquivo sensível alcançado por symlink de pasta, sem tocar na rede", async () => {
	mkdirSync(join(root, ".git"));
	writeFileSync(join(root, ".git", "config"), "x");
	symlinkSync(join(root, ".git"), join(root, "innocent"));
	const { fetch, calls } = stubFetch({ body: {} });
	const result = await tool("upload_blob").handler({ file: "innocent/config" }, new VertraClient("k", { fetch }));
	assert.equal(result.isError, true);
	assert.equal((parseResult(result) as { code: string }).code, "SENSITIVE_FILE");
	assert.equal(calls.length, 0);
});

test("upload_blob recusa pasta de credencial de nuvem", async () => {
	mkdirSync(join(root, ".azure"));
	writeFileSync(join(root, ".azure", "accessTokens.json"), "x");
	const { fetch, calls } = stubFetch({ body: {} });
	const result = await tool("upload_blob").handler({ file: ".azure/accessTokens.json" }, new VertraClient("k", { fetch }));
	assert.equal(result.isError, true);
	assert.equal(calls.length, 0);
});

test("upload_blob pode sobrescrever objeto, então é anotada como destrutiva", () => {
	assert.equal(tool("upload_blob").annotations.readOnlyHint, false);
	assert.equal(tool("upload_blob").annotations.destructiveHint, true);
});
