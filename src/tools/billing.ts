import type { RESTPostAPIOrderCreateBody } from "@vertracloud/api-types/v1";
import { z } from "zod";
import { fetchKnowledgeBase, sliceSection } from "../docs-fetch.js";
import { fail, ok, respond } from "../result.js";
import { R, W, type ToolDefinition } from "./defs.js";
import { enc, str } from "./util.js";

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
		description: "Creates a plan subscription order and returns the final price (with coupon discount, if any) and the `order_id`.",
		group: "billing",
		route: ["POST", "/v1/orders"],
		annotations: W,
		inputSchema: {
			plan: z.string().describe("Desired plan"),
			months: z.number().int().positive().describe("Number of months"),
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
