import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
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

test("a path outside the allowed root is refused", () => {
	assert.throws(() => ensureInsideRoot("/etc/passwd"), (err: LocalError) => err.code === "PATH_OUTSIDE_ROOT");
	assert.throws(() => ensureInsideRoot("../../fora.txt"), (err: LocalError) => err.code === "PATH_OUTSIDE_ROOT");
	assert.equal(ensureInsideRoot("dentro.txt"), join(realpathSync(root), "dentro.txt"));
});

test("a credentials folder inside the root is also refused", () => {
	assert.throws(() => ensureInsideRoot(".ssh/id_ed25519"), (err: LocalError) => err.code === "PATH_NOT_ALLOWED");
});

test("upload_files cannot read a file outside the root", async () => {
	const { fetch, calls } = stubFetch({ body: {} });
	const result = await tools
		.find((t) => t.name === "upload_files")!
		.handler({ id: "app", paths: ["/etc/hosts"] }, new VertraClient("k", { fetch }));

	assert.equal(result.isError, true);
	assert.equal((parseResult(result) as { code: string }).code, "PATH_OUTSIDE_ROOT");
	assert.equal(calls.length, 0, "nada pode ter ido para a rede");
});

test("a directory symlink pointing outside the root is refused, even when lexically inside", () => {
	const outside = mkdtempSync(join(tmpdir(), "vertra-mcp-outside-"));
	writeFileSync(join(outside, "secret.txt"), "segredo");
	symlinkSync(outside, join(root, "link"));

	assert.throws(() => ensureInsideRoot("link/secret.txt"), (err: LocalError) => err.code === "PATH_OUTSIDE_ROOT");
	assert.throws(
		() => zipFiles([join(root, "link", "secret.txt")]),
		(err: LocalError) => err.code === "PATH_OUTSIDE_ROOT",
	);
});

test("zipFiles accepts a file inside the root", () => {
	writeFileSync(join(root, "a.txt"), "oi");
	assert.ok(zipFiles([join(root, "a.txt")]).length > 0);
});

test("download does not overwrite an existing file", () => {
	const dest = join(root, "app.zip");
	writeLocalFile(dest, new Uint8Array([1, 2, 3]));
	assert.throws(() => writeLocalFile(dest, new Uint8Array([4])), (err: LocalError) => err.code === "DEST_EXISTS");
});

test("an internal symlink to a credentials folder does not escape the denylist", () => {
	mkdirSync(join(root, ".ssh"));
	writeFileSync(join(root, ".ssh", "id_ed25519"), "x");
	symlinkSync(join(root, ".ssh"), join(root, "innocent"));
	assert.throws(() => ensureInsideRoot("innocent/id_ed25519"), (err: LocalError) => err.code === "PATH_NOT_ALLOWED");
});

test("the folder denylist is case-insensitive and covers cloud credentials", () => {
	for (const dir of [".SSH", ".Aws", ".azure", ".gcloud", ".oci", ".config"]) {
		assert.throws(() => ensureInsideRoot(`${dir}/x`), (err: LocalError) => err.code === "PATH_NOT_ALLOWED", dir);
	}
});

test("ensureInsideRoot returns the resolved path, the same one that gets opened", () => {
	mkdirSync(join(root, "sub"));
	symlinkSync(join(root, "sub"), join(root, "link"));
	assert.equal(ensureInsideRoot("link/a.txt"), join(realpathSync(root), "sub", "a.txt"));
});

test("a dangling symlink pointing outside the root does not let a write create a folder outside", () => {
	const outside = mkdtempSync(join(tmpdir(), "vertra-mcp-outside-"));
	symlinkSync(join(outside, "missing"), join(root, "dangling"));
	assert.throws(() => writeLocalFile(join(root, "dangling", "x.txt"), new Uint8Array([1])), LocalError);
	assert.equal(existsSync(join(outside, "missing")), false);
});
