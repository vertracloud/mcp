import { DatabaseType } from "@vertracloud/api-types/payloads/v1";
import { z } from "zod";
import { fail, ok, respond } from "../result.js";
import { D, DI, R, W, WI, type ToolDefinition } from "./defs.js";
import { enc, pick, str } from "./util.js";

const id = z.string().min(1).describe("Database ID");
const workspace_id = z.string().optional();

const ENGINES = { postgresql: DatabaseType.POSTGRESQL, mongodb: DatabaseType.MONGODB, redis: DatabaseType.REDIS, mysql: DatabaseType.MYSQL } as const;
type EngineName = keyof typeof ENGINES;

export function engineName(type: unknown): EngineName | "unknown" {
	const found = (Object.keys(ENGINES) as EngineName[]).find((name) => ENGINES[name] === type);
	return found ?? "unknown";
}

/** Customer user of databases created since v26.4.8 (no superuser); its default database has the same name. */
const CUSTOMER_USER = "vertracloud";

/**
 * Connection string per engine. Without user/password, returns `null` (never invents a credential).
 * For the `vertracloud` user, MongoDB authenticates against `admin`.
 */
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
			return `mongodb://${auth}@${host}:${port}${db}?${user === CUSTOMER_USER ? "authSource=admin&" : ""}tls=true`;
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
		name: "list_database_versions",
		description:
			"Lists, per engine, the version lines a new database can use: `recommended` and `available` (newest first). The keys are the engine type ids (1 PostgreSQL, 2 MongoDB, 3 Redis, 4 MySQL). Use it before `create_database` with `version`.",
		group: "databases",
		route: ["GET", "/v1/databases/versions"],
		annotations: R,
		inputSchema: {},
		handler: (_args, client) => client.get("/v1/databases/versions").then((r) => respond(r)),
	},
	{
		name: "get_database",
		description: "Details of a database: engine, version line (e.g. \"18\"), name, memory, address and port. The version of an existing database cannot be changed.",
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
		description:
			"Creates a managed database. Accounts without a plan get PLAN_REQUIRED: a paid plan is needed first. `version` is the engine's version line (e.g. \"18\", \"8.4\"); omit it to get the recommended one — call `list_database_versions` to see the valid lines. Wrong lines fail with INVALID_DATABASE_VERSION. The version of an existing database cannot be changed afterwards.",
		group: "databases",
		route: ["POST", "/v1/databases"],
		annotations: W,
		inputSchema: {
			engine: z.enum(["postgresql", "mongodb", "redis", "mysql"]),
			name: z.string(),
			ram: z.number().int().positive().describe("RAM in MB"),
			version: z
				.string()
				.min(1)
				.optional()
				.describe("Engine version line, e.g. \"18\" or \"8.4\" (never a patch). Omitted = the recommended one. Valid lines per engine: `list_database_versions`."),
			description: z.string().optional(),
			workspace_id: z.string().optional(),
		},
		handler: (args, client) =>
			client
				.post("/v1/databases", {
					type: ENGINES[args.engine as EngineName],
					name: String(args.name),
					ram: Number(args.ram),
					...pick(args, ["version", "description", "workspace_id"]),
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
		annotations: DI,
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
			"Data to connect to the database: address, port, engine, user name, CA certificate in PEM and a connection string (with a `<password>` placeholder, since the API never returns the password). This server does not run queries — you're the one who connects.",
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
				// The API returns `username` (`vertracloud` on databases created since v26.4.8; the engine's own
				// user on older ones). It never returns the password; the database name is only implied for `vertracloud`.
				user: str(body.username ?? body.user),
				password: str(body.password),
				database: str(body.database ?? body.database_name) ?? (str(body.username) === CUSTOMER_USER ? CUSTOMER_USER : undefined),
			};
			return ok({
				id: body.id,
				engine,
				version: body.version ?? null,
				host: parts.host,
				port: parts.port,
				user: parts.user ?? null,
				password: parts.password ?? null,
				database: parts.database ?? null,
				ca_pem: cert.ok ? Buffer.from(cert.body as Uint8Array).toString("utf8") : null,
				ca_error: cert.ok ? undefined : cert.body,
				connection_string: connectionString(engine, parts),
				// Same URL with a placeholder instead of the password, when only the password is missing.
				connection_string_template: parts.password ? undefined : connectionString(engine, { ...parts, password: "<password>" })?.replace("%3Cpassword%3E", "<password>"),
				note:
					parts.user && parts.password
						? undefined
						: "The password is not returned by the API on this read — use the one you saved when the database was created, or generate a new one with `reset_credentials`.",
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
