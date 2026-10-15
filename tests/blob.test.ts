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
	assert.ok(found, `tool ${name} does not exist`);
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

test("each blob tool has the right scope, derived from the catalog", () => {
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

test("listing goes to the blob host, with prefix, delimiter and limit", async () => {
	const { fetch, calls } = stubFetch({ body: { response: { objects: [], folders: [], cursor: null } } });
	await tool("list_blob_objects").handler({ prefix: "fotos/", delimiter: "/", limit: 10 }, new VertraClient("k", { fetch }));
	assert.equal(calls[0]?.url, "https://blob.vertracloud.app/v1/objects?prefix=fotos%2F&delimiter=%2F&limit=10");
	assert.equal(calls[0]?.headers.Authorization, "Bearer k");
});

test("blobBaseUrl changes the host without touching the API one", async () => {
	const { fetch, calls } = stubFetch({ body: { response: {} } });
	const client = new VertraClient("k", { fetch, blobBaseUrl: "http://127.0.0.1:9/v1/" });
	await tool("blob_stats").handler({}, client);
	assert.equal(calls[0]?.url, "http://127.0.0.1:9/v1/stats");
});

test("agent-supplied id is escaped in the blob route and `..` is refused", async () => {
	const { fetch, calls } = stubFetch({ body: { response: {} } });
	await tool("get_blob_object").handler({ id: "../stats" }, new VertraClient("k", { fetch }));
	assert.equal(calls[0]?.url, "https://blob.vertracloud.app/v1/objects/..%2Fstats");

	await assert.rejects(async () => tool("delete_blob_object").handler({ id: ".." }, new VertraClient("k", { fetch })));
	assert.equal(calls.length, 1);
});

test("temporary link asks for a non-redirect response and the expiry", async () => {
	const reply = { url: "https://files.example.com/d/x", expires_at: "2026-10-14T12:00:00.000Z" };
	const { fetch, calls } = stubFetch({ body: { response: reply } });
	const result = await tool("blob_download_url").handler({ id: "9", expires_in: 600 }, new VertraClient("k", { fetch }));
	assert.equal(calls[0]?.url, "https://blob.vertracloud.app/v1/objects/9/download?expires_in=600&redirect=false");
	assert.deepEqual(parseResult(result), reply);
});

test("changing visibility sends a PATCH with only the given field", async () => {
	const { fetch, calls } = stubFetch({ body: { response: { id: "9", visibility: "public" } } });
	await tool("set_blob_visibility").handler({ id: "9", visibility: "public" }, new VertraClient("k", { fetch }));
	assert.equal(calls[0]?.method, "PATCH");
	assert.equal(calls[0]?.url, "https://blob.vertracloud.app/v1/objects/9");
	assert.deepEqual(JSON.parse(String(calls[0]?.body)), { visibility: "public" });
});

test("deleting an object uses DELETE and accepts the null response", async () => {
	const { fetch, calls } = stubFetch({ body: { response: null } });
	const result = await tool("delete_blob_object").handler({ id: "9" }, new VertraClient("k", { fetch }));
	assert.equal(calls[0]?.method, "DELETE");
	assert.deepEqual(parseResult(result), { ok: true });
});

test("a blob API error arrives with the envelope intact", async () => {
	const { fetch } = stubFetch({ status: 404, body: { code: "BLOB_OBJECT_NOT_FOUND" } });
	const result = await tool("get_blob_object").handler({ id: "1" }, new VertraClient("k", { fetch }));
	assert.equal(result.isError, true);
	assert.deepEqual(parseResult(result), { code: "BLOB_OBJECT_NOT_FOUND" });
});

test("upload_blob sends the disk file as multipart, private by default", async () => {
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

test("upload_blob sends rename_on_conflict only when asked", async () => {
	writeFileSync(join(root, "logo.png"), Buffer.from([0x89]));
	const { fetch, calls } = stubFetch({ body: { response: { id: "1", path: "logo-1.png" } } });
	await tool("upload_blob").handler({ file: "logo.png", rename_on_conflict: true }, new VertraClient("k", { fetch }));
	assert.equal(calls[0]?.url, "https://blob.vertracloud.app/v1/objects?path=logo.png&visibility=private&overwrite=false&rename_on_conflict=true");
});

test("upload_blob refuses a sensitive file by name, without touching the network", async () => {
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

test("delimiter only accepts \"/\"", () => {
	const schema = z.object(tool("list_blob_objects").inputSchema as z.ZodRawShape);
	assert.ok(schema.safeParse({ delimiter: "/" }).success);
	assert.ok(!schema.safeParse({ delimiter: "-" }).success);
});

test("upload_blob refuses a file outside the root without touching the network", async () => {
	const { fetch, calls } = stubFetch({ body: {} });
	const result = await tool("upload_blob").handler({ file: "/etc/hosts" }, new VertraClient("k", { fetch }));
	assert.equal(result.isError, true);
	assert.equal((parseResult(result) as { code: string }).code, "PATH_OUTSIDE_ROOT");
	assert.equal(calls.length, 0);
});

test("readLocalFile refuses a file above the limit and a symlink", () => {
	writeFileSync(join(root, "grande.bin"), Buffer.alloc(10));
	assert.throws(() => readLocalFile("grande.bin", 5), (err: LocalError) => err.code === "FILE_TOO_LARGE");
	assert.equal(readLocalFile("grande.bin", 10).bytes.length, 10);

	symlinkSync(join(root, "grande.bin"), join(root, "atalho.bin"));
	assert.throws(() => readLocalFile("atalho.bin", 100), (err: LocalError) => err.code === "NOT_A_FILE");
});

test("the single-request upload limit is 100 MB", () => {
	assert.equal(MAX_SIMPLE_UPLOAD_BYTES, 100 * 1024 * 1024);
});

test("upload_blob refuses a sensitive file reached through a folder symlink, without touching the network", async () => {
	mkdirSync(join(root, ".git"));
	writeFileSync(join(root, ".git", "config"), "x");
	symlinkSync(join(root, ".git"), join(root, "innocent"));
	const { fetch, calls } = stubFetch({ body: {} });
	const result = await tool("upload_blob").handler({ file: "innocent/config" }, new VertraClient("k", { fetch }));
	assert.equal(result.isError, true);
	assert.equal((parseResult(result) as { code: string }).code, "SENSITIVE_FILE");
	assert.equal(calls.length, 0);
});

test("upload_blob refuses a cloud credentials folder", async () => {
	mkdirSync(join(root, ".azure"));
	writeFileSync(join(root, ".azure", "accessTokens.json"), "x");
	const { fetch, calls } = stubFetch({ body: {} });
	const result = await tool("upload_blob").handler({ file: ".azure/accessTokens.json" }, new VertraClient("k", { fetch }));
	assert.equal(result.isError, true);
	assert.equal(calls.length, 0);
});

test("upload_blob can overwrite an object, so it is annotated as destructive", () => {
	assert.equal(tool("upload_blob").annotations.readOnlyHint, false);
	assert.equal(tool("upload_blob").annotations.destructiveHint, true);
});
