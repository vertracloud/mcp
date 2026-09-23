import assert from "node:assert/strict";
import { test } from "vitest";
import { fetchKnowledgeBase, resetDocsCache, sliceSection } from "../src/docs-fetch.js";

const KB = "# KB\n\n## Planos\n\nPro custa X.\n\n### Detalhe\n\nmais\n\n## Limites\n\nnada\n";

test("sliceSection recorta a seção pelo título, sem diferenciar maiúsculas", () => {
	assert.equal(sliceSection(KB, "planos"), "## Planos\n\nPro custa X.\n\n### Detalhe\n\nmais");
	assert.equal(sliceSection(KB, "limites"), "## Limites\n\nnada");
	assert.equal(sliceSection(KB, "inexistente"), null);
});

test("cai do .md para a rota sem extensão quando a primeira dá 404", async () => {
	resetDocsCache();
	const urls: string[] = [];
	const fetchImpl = (async (url: string) => {
		urls.push(String(url));
		return urls.length === 1 ? new Response("", { status: 404 }) : new Response(KB, { status: 200 });
	}) as typeof globalThis.fetch;

	assert.equal(await fetchKnowledgeBase(fetchImpl), KB);
	assert.deepEqual(urls, ["https://docs.vertracloud.app/knowledge-base.md", "https://docs.vertracloud.app/knowledge-base"]);
});

test("o resultado fica em cache por 1h e expira depois", async () => {
	resetDocsCache();
	let hits = 0;
	const fetchImpl = (async () => {
		hits++;
		return new Response(KB, { status: 200 });
	}) as typeof globalThis.fetch;

	await fetchKnowledgeBase(fetchImpl, 0);
	await fetchKnowledgeBase(fetchImpl, 60 * 60 * 1000 - 1);
	assert.equal(hits, 1);

	await fetchKnowledgeBase(fetchImpl, 60 * 60 * 1000 + 1);
	assert.equal(hits, 2);
	resetDocsCache();
});
