import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "vitest";
import { LocalError, ensureInsideRoot, writeLocalFile, zipFiles } from "../src/local.js";
import { VertraClient } from "../src/client.js";
import { tools } from "../src/tools/index.js";
import { parseResult, stubFetch } from "./helpers.js";

let root: string;
const previous = process.env.VERTRA_MCP_ROOT;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "vertra-mcp-"));
	process.env.VERTRA_MCP_ROOT = root;
});

afterEach(() => {
	if (previous === undefined) process.env.VERTRA_MCP_ROOT = "";
	else process.env.VERTRA_MCP_ROOT = previous;
});

test("caminho fora da raiz permitida é recusado", () => {
	assert.throws(() => ensureInsideRoot("/etc/passwd"), (err: LocalError) => err.code === "PATH_OUTSIDE_ROOT");
	assert.throws(() => ensureInsideRoot("../../fora.txt"), (err: LocalError) => err.code === "PATH_OUTSIDE_ROOT");
	assert.equal(ensureInsideRoot("dentro.txt"), join(root, "dentro.txt"));
});

test("pasta de credencial dentro da raiz também é recusada", () => {
	assert.throws(() => ensureInsideRoot(".ssh/id_ed25519"), (err: LocalError) => err.code === "PATH_NOT_ALLOWED");
});

test("upload_files não consegue ler arquivo fora da raiz", async () => {
	const { fetch, calls } = stubFetch({ body: {} });
	const result = await tools
		.find((t) => t.name === "upload_files")!
		.handler({ id: "app", paths: ["/etc/hosts"] }, new VertraClient("k", { fetch }));

	assert.equal(result.isError, true);
	assert.equal((parseResult(result) as { code: string }).code, "PATH_OUTSIDE_ROOT");
	assert.equal(calls.length, 0, "nada pode ter ido para a rede");
});

test("zipFiles aceita arquivo dentro da raiz", () => {
	writeFileSync(join(root, "a.txt"), "oi");
	assert.ok(zipFiles([join(root, "a.txt")]).length > 0);
});

test("download não sobrescreve arquivo existente", () => {
	const dest = join(root, "app.zip");
	writeLocalFile(dest, new Uint8Array([1, 2, 3]));
	assert.throws(() => writeLocalFile(dest, new Uint8Array([4])), (err: LocalError) => err.code === "DEST_EXISTS");
});
