import assert from "node:assert/strict";
import { test } from "vitest";
import { toolsFor } from "../src/server.js";
import { tools } from "../src/tools/index.js";

const LOCAL = ["create_app", "deploy_app", "upload_files", "download_app", "download_snapshot"];

test("o modo remoto (local: false) não registra as tools que tocam o disco", () => {
	const remote = toolsFor(false).map((t) => t.name);
	for (const name of LOCAL) assert.ok(!remote.includes(name), `${name} não pode aparecer no modo remoto`);
	assert.equal(remote.length, tools.length - LOCAL.length);
});

test("o modo local registra tudo", () => {
	const local = toolsFor(true).map((t) => t.name);
	for (const name of LOCAL) assert.ok(local.includes(name));
	assert.equal(local.length, tools.length);
});

test("toda tool marcada `local` está na lista conhecida", () => {
	assert.deepEqual(tools.filter((t) => t.local).map((t) => t.name).sort(), [...LOCAL].sort());
});
