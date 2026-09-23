import { DatabaseType } from "@vertracloud/api-types/payloads/v1";
import { z } from "zod";
import { fail, ok, respond } from "../result.js";
import { D, R, W, WI, type ToolDefinition } from "./defs.js";
import { enc, pick, str } from "./util.js";

const id = z.string().describe("Database ID");
const workspace_id = z.string().optional();

const ENGINES = { postgresql: DatabaseType.POSTGRESQL, mongodb: DatabaseType.MONGODB, redis: DatabaseType.REDIS, mysql: DatabaseType.MYSQL } as const;
type EngineName = keyof typeof ENGINES;

export function engineName(type: unknown): EngineName | "unknown" {
	const found = (Object.keys(ENGINES) as EngineName[]).find((name) => ENGINES[name] === type);
	return found ?? "unknown";
}

/** Connection string per engine. Without user/password, returns `null` (never invents a credential). */
export function connectionString(engine: EngineName | "unknown", parts: { host?: string; port?: number; user?: string; password?: string; database?: string }): string | null {
	const { host, port, user, password, database } = parts;
	if (!host || !port || !user || !password) return null;
	const auth = `${encodeURIComponent(user)}:${encodeURIComponent(password)}`;
	const db = database ? `/${encodeURIComponent(database)}` : "";
	switch (engine) {
		case "postgresql":
			return `postgresql://${auth}@${host}:${port}${db || "/"}?sslmode=verify-ca`;
		case "mysql":
			return `mysql://${auth}@${host}:${port}${db}?ssl-mode=VERIFY_CA`;
		case "redis":
			return `rediss://${auth}@${host}:${port}`;
		case "mongodb":
			return `mongodb://${auth}@${host}:${port}${db}?tls=true`;
		default:
			return null;
	}
}

export const databasesTools: ToolDefinition[] = [
	{
		name: "list_databases",
		description: "Lists the account's databases with the status of each.",
		group: "databases",
		route: ["GET", "/v1/databases/status"],
		annotations: R,
		inputSchema: {},
		handler: (_args, client) => client.get("/v1/databases/status").then((r) => respond(r)),
	},
	{
		name: "get_database",
		description: "Details of a database: engine, name, memory, address and port.",
		group: "databases",
		route: ["GET", "/v1/databases/:id"],
		annotations: R,
		inputSchema: { id, workspace_id },
		handler: (args, client) =>
			client.get(`/v1/databases/${enc(args.id)}`, { workspace_id: str(args.workspace_id) }).then((r) => respond(r)),
	},
	{
		name: "get_database_status",
		description: "Live status (CPU, RAM, disk, uptime) of a database; without `id`, of all of them.",
		group: "databases",
		route: ["GET", "/v1/databases/:id/status"],
		annotations: R,
		inputSchema: { id: id.optional(), workspace_id },
		handler: (args, client) => {
			const dbId = str(args.id);
			const path = dbId ? `/v1/databases/${enc(dbId)}/status` : "/v1/databases/status";
			return client.get(path, { workspace_id: str(args.workspace_id) }).then((r) => respond(r));
		},
	},
	{
		name: "get_database_metrics",
		description: "History of CPU, RAM, storage and network usage of the database.",
		group: "databases",
		route: ["GET", "/v1/databases/:id/metrics"],
		annotations: R,
		inputSchema: { id, range: z.enum(["10m", "30m", "24h"]).optional(), workspace_id },
		handler: (args, client) =>
			client
				.get(`/v1/databases/${enc(args.id)}/metrics`, { range: str(args.range), workspace_id: str(args.workspace_id) })
				.then((r) => respond(r)),
	},
	{
		name: "create_database",
		description: "Creates a managed database.",
		group: "databases",
		route: ["POST", "/v1/databases"],
		annotations: W,
		inputSchema: {
			engine: z.enum(["postgresql", "mongodb", "redis", "mysql"]),
			name: z.string(),
			ram: z.number().int().positive().describe("RAM in MB"),
			description: z.string().optional(),
			workspace_id: z.string().optional(),
		},
		handler: (args, client) =>
			client
				.post("/v1/databases", {
					type: ENGINES[args.engine as EngineName],
					name: String(args.name),
					ram: Number(args.ram),
					...pick(args, ["description", "workspace_id"]),
				})
				.then((r) => respond(r)),
	},
	{
		name: "update_database",
		description: "Changes the database's name, description or memory.",
		group: "databases",
		route: ["PUT", "/v1/databases/:id"],
		annotations: WI,
		inputSchema: { id, name: z.string().optional(), description: z.string().optional(), ram: z.number().int().positive().optional(), workspace_id },
		handler: (args, client) =>
			client
				.put(`/v1/databases/${enc(args.id)}`, pick(args, ["name", "description", "ram"]), { workspace_id: str(args.workspace_id) })
				.then((r) => respond(r)),
	},
	{
		name: "start_database",
		description: "Turns the database on.",
		group: "databases",
		route: ["POST", "/v1/databases/:id/start"],
		annotations: WI,
		inputSchema: { id, workspace_id },
		handler: (args, client) =>
			client.post(`/v1/databases/${enc(args.id)}/start`, undefined, { workspace_id: str(args.workspace_id) }).then((r) => respond(r)),
	},
	{
		name: "stop_database",
		description: "Turns the database off.",
		group: "databases",
		route: ["POST", "/v1/databases/:id/stop"],
		annotations: WI,
		inputSchema: { id, workspace_id },
		handler: (args, client) =>
			client.post(`/v1/databases/${enc(args.id)}/stop`, undefined, { workspace_id: str(args.workspace_id) }).then((r) => respond(r)),
	},
	{
		name: "reset_database",
		description: "DELETES ALL DATA in the database and leaves it empty. There is no way to undo this without a snapshot.",
		group: "databases",
		route: ["POST", "/v1/databases/:id/reset"],
		annotations: D,
		inputSchema: { id, workspace_id },
		handler: (args, client) =>
			client.post(`/v1/databases/${enc(args.id)}/reset`, undefined, { workspace_id: str(args.workspace_id) }).then((r) => respond(r)),
	},
	{
		name: "delete_database",
		description: "Permanently deletes the database, along with the data inside it.",
		group: "databases",
		route: ["DELETE", "/v1/databases/:id"],
		annotations: D,
		inputSchema: { id, workspace_id },
		handler: (args, client) =>
			client.delete(`/v1/databases/${enc(args.id)}`, { workspace_id: str(args.workspace_id) }).then((r) => respond(r)),
	},
	{
		name: "get_connection_info",
		description:
			"Data to connect to the database: address, port, engine, CA certificate in PEM and, when the account has one, a ready-made connection string. This server does not run queries — you're the one who connects.",
		group: "databases",
		route: ["GET", "/v1/databases/:id/credentials/certificate"],
		annotations: R,
		inputSchema: { id, workspace_id },
		handler: async (args, client) => {
			const query = { workspace_id: str(args.workspace_id) };
			const [db, cert] = await Promise.all([
				client.get<Record<string, unknown>>(`/v1/databases/${enc(args.id)}`, query),
				client.download(`/v1/databases/${enc(args.id)}/credentials/certificate`, query),
			]);
			if (!db.ok) return fail(db.body);

			const body = db.body as Record<string, unknown>;
			const engine = engineName(body.type);
			const parts = {
				host: str(body.host),
				port: body.port === undefined ? undefined : Number(body.port),
				// The API does not return user/password/database name on read; when it does, pass it through.
				user: str(body.username ?? body.user),
				password: str(body.password),
				database: str(body.database ?? body.database_name),
			};
			return ok({
				id: body.id,
				engine,
				host: parts.host,
				port: parts.port,
				user: parts.user ?? null,
				password: parts.password ?? null,
				database: parts.database ?? null,
				ca_pem: cert.ok ? Buffer.from(cert.body as Uint8Array).toString("utf8") : null,
				ca_error: cert.ok ? undefined : cert.body,
				connection_string: connectionString(engine, parts),
				note:
					parts.user && parts.password
						? undefined
						: "User and password are not returned by the API on this read — get them from the dashboard, or generate a new password with `reset_credentials`.",
			});
		},
	},
	{
		name: "reset_credentials",
		description: "Generates a new password for the database and returns it. Anyone connected with the old password gets disconnected.",
		group: "databases",
		route: ["POST", "/v1/databases/:id/credentials/reset"],
		annotations: D,
		inputSchema: { id, workspace_id },
		handler: (args, client) =>
			client
				.post(`/v1/databases/${enc(args.id)}/credentials/reset`, undefined, { workspace_id: str(args.workspace_id) })
				.then((r) => respond(r)),
	},
	{
		name: "reset_certificate",
		description: "Issues a new certificate for the database. Anyone using the old certificate stops being able to connect.",
		group: "databases",
		route: ["POST", "/v1/databases/:id/credentials/certificate/reset"],
		annotations: D,
		inputSchema: { id, workspace_id },
		handler: (args, client) =>
			client
				.post(`/v1/databases/${enc(args.id)}/credentials/certificate/reset`, undefined, { workspace_id: str(args.workspace_id) })
				.then((r) => respond(r)),
	},
];
