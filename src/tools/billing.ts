import type { APIPlan, APIPlansCatalog, RESTPostAPIOrderCreateBody, RESTPostAPIOrderQuoteBody } from "@vertracloud/api-types/v1";
import { z } from "zod";
import { fail, ok, respond } from "../result.js";
import { R, W, WI, type ToolDefinition } from "./defs.js";
import { enc, pick, str } from "./util.js";

function slimPlan(p: APIPlan) {
	return {
		name: p.name,
		family: p.family,
		legacy: p.legacy || undefined,
		memory_mb: p.memory_mb,
		max_vcpus_per_app: p.max_vcpus_per_app,
		price: p.price,
		payment_methods: p.payment_methods,
		limits: {
			deploys_per_hour: p.limits.deploys_per_hour,
			requests_per_minute: p.limits.requests_per_minute,
			max_domains: p.limits.max_domains,
			manual_backups_per_day: p.limits.manual_backups_per_day,
			workspace_members: p.limits.workspace_members,
			release_versions: p.limits.release_versions,
			max_custom_images: p.limits.max_custom_images,
			blob_quota_bytes: p.limits.blob.quota_bytes,
		},
		features: {
			custom_subdomain: p.features.custom_subdomain,
			create_workspace: p.features.create_workspace,
			database_manager: p.features.database_manager,
			rollback: p.features.rollback,
			auto_rollback: p.features.auto_rollback,
			zero_downtime: p.features.zero_downtime,
		},
	};
}

/** Compact answer for the agent: the grid, the cycles and the main numbers of each plan. */
function slimCatalog({ grid, cycles, plans }: APIPlansCatalog) {
	return { grid, cycles, plans: plans.map(slimPlan) };
}

export const billingTools: ToolDefinition[] = [
	{
		name: "list_plans",
		description:
			"The plans currently for sale, straight from the API: the grid in force, the billing cycles with their discounts and, per plan, name, RAM, vCPU per app, monthly price (BRL), payment methods and the main limits and features. Use it before stating any plan, price or limit; `quote_order` gives the exact amount for a plan and cycle.",
		group: "billing",
		scope: null,
		annotations: R,
		inputSchema: {},
		handler: (_args, client) => client.get("/v1/plans").then((r) => respond(r, (body) => slimCatalog(body as APIPlansCatalog))),
	},
	{
		name: "quote_order",
		description:
			"Prices a plan for a billing cycle, with an optional coupon, without creating an order or using the coupon: list price, cycle discount, coupon discount, final `total` and whether the price is the one the account had before the current grid (`legacy_price`, valid until `legacy_price_until`). Use it to tell the user the exact amount before `create_order`. Possible errors: INVALID_PLAN, INVALID_MONTHS, PLAN_NOT_FOR_SALE and the COUPON_* codes.",
		group: "billing",
		route: ["POST", "/v1/orders/quote"],
		annotations: R,
		inputSchema: {
			plan: z.string().min(1).describe("Plan name, as returned by `list_plans`"),
			months: z.number().int().positive().describe("Billing cycle in months: 1, 3, 6 or 12; discounts in `list_plans`"),
			coupon: z.string().optional().describe("Discount coupon"),
		},
		handler: (args, client) => {
			const body = { plan: String(args.plan), months: Number(args.months), coupon: str(args.coupon) } as RESTPostAPIOrderQuoteBody;
			return client.post("/v1/orders/quote", body).then((r) => respond(r));
		},
	},
	{
		name: "create_order",
		description: "Creates a plan subscription order and returns the final price (with coupon discount, if any) and the `order_id`. Requires complete billing details (name, address and, in Brazil, CPF/CNPJ); without them it fails with BILLING_DETAILS_INCOMPLETE — use `set_billing_details` after the user gives the data. Accounts without a plan cannot create apps or databases until an order is paid.",
		group: "billing",
		route: ["POST", "/v1/orders"],
		annotations: W,
		inputSchema: {
			plan: z.string().describe("Desired plan"),
			months: z.number().int().positive().describe("Number of months: 1, 3, 6 or 12; discounts in `list_plans`"),
			coupon: z.string().optional().describe("Discount coupon"),
		},
		handler: (args, client) => {
			// `type` is not exposed to the agent: without a dedicated renewal/upgrade tool, the
			// order is always a new purchase; the server already defaults to that.
			const body: RESTPostAPIOrderCreateBody = { plan: String(args.plan), months: Number(args.months) as RESTPostAPIOrderCreateBody["months"], coupon: str(args.coupon) };
			return client.post("/v1/orders", body).then((r) => respond(r));
		},
	},
	{
		name: "get_billing_details",
		description: "The account's billing details (name, address, phone, masked CPF/CNPJ) and `complete`, which says whether they are enough to create an order. `null` until saved.",
		group: "billing",
		route: ["GET", "/v1/users/me/billing"],
		annotations: R,
		inputSchema: {},
		handler: (_args, client) => client.get("/v1/users/me/billing").then((r) => respond(r)),
	},
	{
		name: "set_billing_details",
		description:
			"Replaces the account's billing details. SENDS THE USER'S PERSONAL DATA (name, address and CPF/CNPJ): use it only when the user provided these values in this conversation, never guess or invent them. In Brazil, `number`, `district`, `city_code` (7-digit IBGE), `state` and an 8-digit `postal_code` are required, plus `tax_id`; outside Brazil, `line1`, `city` and `postal_code`. Omitting `tax_id` keeps the saved one.",
		group: "billing",
		route: ["PUT", "/v1/users/me/billing"],
		annotations: WI,
		inputSchema: {
			name: z.string().describe("Full name or company name"),
			address: z.object({
				line1: z.string().describe("Street"),
				number: z.string().nullable().optional().describe('Street number; "S/N" when there is none'),
				line2: z.string().nullable().optional().describe("Complement"),
				district: z.string().nullable().optional().describe("Neighborhood (bairro)"),
				city: z.string(),
				city_code: z.string().nullable().optional().describe("7-digit IBGE city code"),
				state: z.string().nullable().optional().describe('Two-letter state code in Brazil, e.g. "CE"'),
				postal_code: z.string().nullable().optional().describe("CEP (8 digits) in Brazil"),
				country: z.string().length(2).describe('ISO-2 country code, e.g. "BR"'),
			}),
			phone: z.string().nullable().optional().describe("E.164, e.g. +5585999990000; null removes it"),
			tax_id: z.object({ type: z.enum(["cpf", "cnpj"]), value: z.string() }).nullable().optional().describe("CPF or CNPJ; null removes it, omitted keeps it"),
		},
		handler: (args, client) => {
			const address = args.address as Record<string, unknown>;
			const body = {
				name: String(args.name),
				address: { number: null, line2: null, district: null, city_code: null, state: null, postal_code: null, ...address },
				...pick(args, ["phone", "tax_id"]),
			};
			return client.put("/v1/users/me/billing", body).then((r) => respond(r));
		},
	},
	{
		name: "get_pix",
		description:
			"Generates the order's PIX payment and returns the copy-and-paste code and the QR Code. THE PERSON PAYS, in their banking app — the agent never pays anything. The QR expires at `expires_at` (up to 30 min); calling get_pix again for the same open order returns a fresh QR.",
		group: "billing",
		route: ["POST", "/v1/orders/:orderId/initiate/pix"],
		annotations: W,
		inputSchema: { order_id: z.string().min(1) },
		handler: (args, client) => client.post(`/v1/orders/${enc(args.order_id)}/initiate/pix`).then((r) => respond(r)),
	},
	{
		name: "get_order_status",
		description: "Status of an order; poll it periodically until it turns paid. `expires_at` is when the unpaid order (invoice) expires, 72 h after creation.",
		group: "billing",
		route: ["GET", "/v1/orders/:orderId/status"],
		annotations: R,
		inputSchema: { order_id: z.string().min(1) },
		handler: (args, client) => client.get(`/v1/orders/${enc(args.order_id)}/status`).then((r) => respond(r)),
	},
	{
		name: "list_orders",
		description: "The account's orders.",
		group: "billing",
		route: ["GET", "/v1/orders"],
		annotations: R,
		inputSchema: { page: z.number().int().positive().optional() },
		handler: (args, client) => client.get("/v1/orders", { page: str(args.page) }).then((r) => respond(r)),
	},
	{
		name: "redeem_code",
		description: "Redeems a promotional code on the account.",
		group: "billing",
		route: ["POST", "/v1/redeem/:code"],
		annotations: W,
		inputSchema: { code: z.string().min(1) },
		handler: (args, client) => client.post(`/v1/redeem/${enc(args.code)}`).then((r) => respond(r)),
	},
];
