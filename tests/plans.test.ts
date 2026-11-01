import assert from "node:assert/strict";
import { test } from "vitest";
import { z } from "zod";
import { VertraClient } from "../src/client.js";
import { toolScope, tools } from "../src/tools/index.js";
import { parseResult, stubFetch } from "./helpers.js";

const tool = (name: string) => {
	const found = tools.find((t) => t.name === name);
	assert.ok(found, `tool ${name} não existe`);
	return found;
};

const plan = {
	name: "starter-2",
	family: "starter",
	legacy: false,
	memory_mb: 2048,
	max_vcpus_per_app: 2,
	price: 29.9,
	payment_methods: ["pix", "card"],
	limits: {
		deploys_per_hour: 20,
		requests_per_minute: 120,
		requests_per_day: 43200,
		max_domains: 1,
		max_domain_ports: 1,
		manual_backups_per_day: 16,
		workspace_members: 2,
		workspace_roles: 1,
		release_versions: 3,
		release_retention_days: 7,
		max_custom_images: 0,
		blob: { quota_bytes: 1_000_000, max_rules: 1, max_custom_domains: 0, image_transformations_per_month: 0, s3_requests_per_10s: 10 },
	},
	features: { custom_subdomain: true, create_workspace: true, database_manager: false, rollback: true, auto_rollback: false, zero_downtime: true, web_published: true },
};
const catalog = { grid: "v3", cycles: [{ months: 1, discount_percent: 0 }, { months: 12, discount_percent: 25 }], plans: [plan] };

test("list_plans lê GET /v1/plans e devolve a grade enxuta", async () => {
	const { fetch, calls } = stubFetch({ body: { response: catalog } });
	const result = await tool("list_plans").handler({}, new VertraClient("k", { fetch }));

	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.method, "GET");
	assert.ok(calls[0]?.url.endsWith("/v1/plans"));
	const out = parseResult(result) as { grid: string; cycles: unknown[]; plans: Record<string, unknown>[] };
	assert.equal(out.grid, "v3");
	assert.deepEqual(out.cycles, catalog.cycles);
	assert.equal(out.plans[0]?.name, "starter-2");
	assert.equal(out.plans[0]?.price, 29.9);
	assert.equal((out.plans[0]?.limits as Record<string, unknown>).blob_quota_bytes, 1_000_000);
	assert.equal((out.plans[0]?.features as Record<string, unknown>).zero_downtime, true);
	assert.equal("requests_per_day" in (out.plans[0]?.limits as object), false);
});

test("list_plans repassa o erro da api intacto", async () => {
	const { fetch } = stubFetch({ status: 503, body: { code: "SERVICE_UNAVAILABLE" } });
	const result = await tool("list_plans").handler({}, new VertraClient("k", { fetch }));
	assert.equal(result.isError, true);
	assert.deepEqual(parseResult(result), { code: "SERVICE_UNAVAILABLE" });
});

test("list_plans é pública: sem escopo de chave", () => {
	assert.equal(toolScope(tool("list_plans")), null);
});

test("quote_order faz POST /v1/orders/quote com o escopo billing:read", async () => {
	assert.equal(toolScope(tool("quote_order")), "billing:read");
	assert.equal(tool("quote_order").annotations.readOnlyHint, true);

	const quote = { plan: "pro-4", months: 6, list_price: 600, period_discount_percent: 15, coupon: null, total: 510, legacy_price: false, legacy_price_until: null, payment_methods: ["pix"] };
	const { fetch, calls } = stubFetch({ body: { response: quote } });
	const result = await tool("quote_order").handler({ plan: "pro-4", months: 6, coupon: "V3-X" }, new VertraClient("k", { fetch }));

	assert.equal(calls[0]?.method, "POST");
	assert.ok(calls[0]?.url.endsWith("/v1/orders/quote"));
	assert.deepEqual(JSON.parse(String(calls[0]?.body)), { plan: "pro-4", months: 6, coupon: "V3-X" });
	assert.deepEqual(parseResult(result), quote);
});

test("quote_order sem cupom não envia o campo e repassa COUPON_*", async () => {
	const { fetch, calls } = stubFetch({ status: 400, body: { code: "PLAN_NOT_FOR_SALE" } });
	const result = await tool("quote_order").handler({ plan: "starter-1", months: 1 }, new VertraClient("k", { fetch }));

	assert.deepEqual(JSON.parse(String(calls[0]?.body)), { plan: "starter-1", months: 1 });
	assert.equal(result.isError, true);
	assert.deepEqual(parseResult(result), { code: "PLAN_NOT_FOR_SALE" });
});

test("quote_order e create_order aceitam months de 1 a 12 sem números de desconto no texto", () => {
	const schema = z.object(tool("quote_order").inputSchema as z.ZodRawShape);
	assert.equal(schema.safeParse({ plan: "pro-4", months: 0 }).success, false);
	assert.equal(schema.safeParse({ plan: "pro-4", months: 6 }).success, true);
	const months = (tool("create_order").inputSchema as Record<string, z.ZodTypeAny>).months;
	assert.ok(!/\d+%/.test(months?.description ?? ""));
	assert.ok(!/Economy/.test(months?.description ?? ""));
});
