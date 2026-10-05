import type { RESTPostAPIOrderCreateBody } from "@vertracloud/api-types/v1";
import { z } from "zod";
import { fetchKnowledgeBase, sliceSection } from "../docs-fetch.js";
import { fail, ok, respond } from "../result.js";
import { R, W, WI, type ToolDefinition } from "./defs.js";
import { enc, pick, str } from "./util.js";

export const billingTools: ToolDefinition[] = [
	{
		name: "list_plans",
		description: "Plans and prices, straight from the public knowledge base (not from a route).",
		group: "billing",
		scope: null,
		annotations: R,
		inputSchema: {},
		handler: async () => {
			try {
				const markdown = await fetchKnowledgeBase();
				return ok(sliceSection(markdown, "plano") ?? markdown);
			} catch (err) {
				return fail({ code: "DOCS_UNAVAILABLE", message: err instanceof Error ? err.message : String(err) });
			}
		},
	},
	{
		name: "create_order",
		description: "Creates a plan subscription order and returns the final price (with coupon discount, if any) and the `order_id`. Requires complete billing details (name, address and, in Brazil, CPF/CNPJ); without them it fails with BILLING_DETAILS_INCOMPLETE — use `set_billing_details` after the user gives the data. Accounts on the suspended Free plan cannot create apps or databases until an order is paid.",
		group: "billing",
		route: ["POST", "/v1/orders"],
		annotations: W,
		inputSchema: {
			plan: z.string().describe("Desired plan"),
			months: z.number().int().positive().describe("Number of months: 1, 3 or 12 (3 months get 5% off, 12 get 15% off). The Economy plan only accepts 1."),
			coupon: z.string().optional().describe("Discount coupon"),
		},
		handler: (args, client) => {
			// `type` is not exposed to the agent: without a dedicated renewal/upgrade tool, the
			// order is always a new purchase; the server already defaults to that.
			const body: RESTPostAPIOrderCreateBody = { plan: String(args.plan), months: Number(args.months), coupon: str(args.coupon) };
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
			"Generates the order's PIX payment and returns the copy-and-paste code and the QR Code. THE PERSON PAYS, in their banking app — the agent never pays anything.",
		group: "billing",
		route: ["POST", "/v1/orders/:orderId/initiate/pix"],
		annotations: W,
		inputSchema: { order_id: z.string() },
		handler: (args, client) => client.post(`/v1/orders/${enc(args.order_id)}/initiate/pix`).then((r) => respond(r)),
	},
	{
		name: "get_order_status",
		description: "Status of an order; poll it periodically until it turns paid.",
		group: "billing",
		route: ["GET", "/v1/orders/:orderId/status"],
		annotations: R,
		inputSchema: { order_id: z.string() },
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
		inputSchema: { code: z.string() },
		handler: (args, client) => client.post(`/v1/redeem/${enc(args.code)}`).then((r) => respond(r)),
	},
];
