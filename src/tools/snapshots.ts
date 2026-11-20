import { z } from "zod";
import { type ApiErrorBody, SNAPSHOT_TIMEOUT_MS, type VertraClient } from "../client.js";
import { fail, ok, respond } from "../result.js";
import { D, R, W, type ToolDefinition } from "./defs.js";
import { downloadToLocal, enc, guardLocal, str } from "./util.js";

const scope = z.enum(["applications", "databases"]).describe("Resource type");
const optionalScope = scope.optional().describe("Resource type (optional: the job is found by its id)");
const resource_id = z.string().min(1).describe("Application or database ID");
const workspace_id = z.string().optional().describe("ID of the workspace that owns the resource, if any");

const POLL_MS = 2_000;
const FINAL_JOB_STATUSES = new Set(["ready", "skipped", "failed"]);

export interface JobView {
	id?: string;
	snapshot_id?: string;
	status?: string;
	kind?: string;
	reason?: string;
	details?: Record<string, unknown>;
	progress?: { phase?: string; percent?: number; done_bytes?: number; total_bytes?: number; eta_seconds?: number };
}

/** Reads a job and, while it is not final, polls it every few seconds for up to `waitSeconds`. Returns the last read. */
export async function followJob(client: VertraClient, resourceId: string, jobId: string, scope: string | undefined, waitSeconds: number, workspaceId?: string): Promise<{ ok: true; job: JobView } | { ok: false; body: ApiErrorBody }> {
	const deadline = Date.now() + waitSeconds * 1000;
	for (;;) {
		const res = await client.get<JobView>(`/v1/users/${enc(resourceId)}/snapshots/jobs/${enc(jobId)}`, { scope, workspace_id: workspaceId });
		if (!res.ok) return { ok: false, body: res.body as ApiErrorBody };
		const job = res.body as JobView;
		if (FINAL_JOB_STATUSES.has(String(job.status)) || Date.now() + POLL_MS > deadline) return { ok: true, job };
		await new Promise((r) => setTimeout(r, POLL_MS));
	}
}

function bytesText(n: number): string {
	if (n < 1024) return `${n} B`;
	let value = n;
	let unit = "B";
	for (const next of ["KiB", "MiB", "GiB", "TiB"]) {
		value /= 1024;
		unit = next;
		if (value < 1024) break;
	}
	return `${value.toFixed(1)} ${unit}`;
}

/** One line for the progress of a running job: phase, percent, bytes and time left, whichever the API sent. */
function progressText(progress: JobView["progress"]): string {
	if (!progress) return "";
	const parts: string[] = [];
	if (progress.phase) parts.push(progress.phase);
	if (typeof progress.percent === "number") parts.push(`${Math.round(progress.percent)}%`);
	if (typeof progress.total_bytes === "number" && progress.total_bytes > 0) parts.push(`${bytesText(progress.done_bytes ?? 0)} of ${bytesText(progress.total_bytes)}`);
	else if (typeof progress.done_bytes === "number" && progress.done_bytes > 0) parts.push(bytesText(progress.done_bytes));
	if (typeof progress.eta_seconds === "number" && progress.eta_seconds > 0) parts.push(`about ${progress.eta_seconds < 90 ? `${Math.round(progress.eta_seconds)} s` : `${Math.round(progress.eta_seconds / 60)} min`} left`);
	return parts.join(", ");
}

function jobMessage(job: JobView): string {
	const reason = job.reason ? ` with ${job.reason}` : "";
	const details = job.details && Object.keys(job.details).length > 0 ? ` Details: ${JSON.stringify(job.details)}.` : "";
	switch (job.status) {
		case "queued":
			return "Waiting to start. Call get_snapshot_job again in a few seconds.";
		case "running": {
			const progress = progressText(job.progress);
			return `Still in progress${progress ? ` (${progress})` : ""}. Call get_snapshot_job again in a few seconds.`;
		}
		case "ready":
			return job.kind === "restore" ? "The restore finished." : "The snapshot finished.";
		case "skipped":
			return `The job was skipped${job.reason ? ` (${job.reason})` : ""}: the resource went away, or the database was stopped, meanwhile.${details}`;
		case "failed":
			return `The job FAILED${reason}. ${job.kind === "restore" ? "The content was not restored." : ""}${details}`.trim();
		default:
			return "";
	}
}

export const snapshotsTools: ToolDefinition[] = [
	{
		name: "list_snapshots",
		description: "Snapshots of a resource; without `resource_id`, snapshots of every resource of that type.",
		group: "snapshots",
		route: ["GET", "/v1/users/:id/snapshots"],
		annotations: R,
		inputSchema: { scope, resource_id: resource_id.optional(), workspace_id },
		handler: (args, client) => {
			const id = str(args.resource_id);
			const path = id ? `/v1/users/${enc(id)}/snapshots` : "/v1/users/snapshots";
			return client.get(path, { scope: String(args.scope), workspace_id: id ? str(args.workspace_id) : undefined }).then((r) => respond(r));
		},
	},
	{
		name: "create_snapshot",
		description:
			"Takes a snapshot of the resource. Counts against the plan's snapshot quota: 8 per GB of plan RAM in a rolling 24 hours, 1 every 180 s per resource and 1 request every 5 s per user (a plain 429 RATE_LIMIT_EXCEEDED with `details.retry_after`). Past the other limits the answer is 429 SNAPSHOT_RATE_LIMITED (`details.scope`: resource or account; `details.retry_after` in seconds; `details.resets_at` for the account quota). Can take over a minute: when the snapshot is not done in about 90 s the answer is `{ status: \"accepted\", job_id, message }` (HTTP 202, NOT an error); follow `job_id` with `get_snapshot_job` (same `scope`, `resource_id` = this resource), and the snapshot shows up in `list_snapshots` when ready. 409 OPERATION_IN_PROGRESS means another operation is running on the app; try again shortly.",
		group: "snapshots",
		route: ["POST", "/v1/users/:id/snapshots"],
		annotations: W,
		inputSchema: { scope, resource_id, workspace_id },
		handler: (args, client) =>
			client.post(`/v1/users/${enc(args.resource_id)}/snapshots`, undefined, { scope: String(args.scope), workspace_id: str(args.workspace_id) }, undefined, SNAPSHOT_TIMEOUT_MS).then((r) => {
				if (r.ok && r.status === 202) {
					const jobId = (r.body as { job_id?: unknown } | undefined)?.job_id;
					if (typeof jobId !== "string") return fail({ code: "SNAPSHOT_FAILED", message: "The snapshot is still being taken but no job_id came back." });
					return ok({
						status: "accepted",
						job_id: jobId,
						message: "The snapshot is still being taken (not an error). Follow job_id with get_snapshot_job (same scope, resource_id = this resource); it shows up in list_snapshots when ready.",
					});
				}
				return respond(r);
			}),
	},
	{
		name: "restore_snapshot",
		description:
			"Restores a snapshot OVER the resource: the current content is replaced. The restore runs in the background: the answer (202) is `{ job_id, warning?, message }` and the resource is NOT restored yet. Follow `job_id` with `get_snapshot_job` (same `scope`, `resource_id` = the resource being restored) until `status` is ready (done) or failed (`reason` says why). While it runs every write to the resource returns 409 RESTORE_IN_PROGRESS (reads and deleting the resource still work). For an application on a custom image, `restore_image_version: true` also goes back to the image version it ran when the snapshot was taken, if that version still exists. When it does not, the data is restored and the answer carries `warning: \"IMAGE_VERSION_NOT_FOUND\"`: the application stays on its current version. This cannot be undone: to keep a copy of the current content, call `create_snapshot` first. Refused before it starts: 400 SNAPSHOT_EXCEEDS_STORAGE (`details.required_bytes`, `details.available_bytes`, `details.required_ram_mb` for databases: the snapshot does not fit), 409 APP_BUILDING (the app is deploying), 409 RESTORE_IN_PROGRESS (a restore is already running on the resource), 409 OPERATION_IN_PROGRESS (a snapshot of the app is running; try again shortly) and 429 RESTORE_COOLDOWN (restores are spaced: an application waits 60 s between restores, a database 60 s per user and 120 s per database; `details.retry_after`). A database job can end failed with SNAPSHOT_VERSION_NEWER, SNAPSHOT_ENGINE_MISMATCH or SNAPSHOT_IMPORT_FAILED; any job with SNAPSHOT_CORRUPTED or SNAPSHOT_TIMEOUT.",
		group: "snapshots",
		route: ["POST", "/v1/users/:id/snapshots/:snapshot_id/restore"],
		annotations: D,
		inputSchema: {
			scope,
			resource_id,
			snapshot_id: z.string().min(1),
			target_id: z.string().optional().describe("Restore into a different resource"),
			restore_image_version: z
				.boolean()
				.optional()
				.describe("Applications on a custom image: also go back to the image version of the snapshot, if it still exists (default: data only)"),
			workspace_id,
		},
		handler: (args, client) => {
			const body = {
				...(args.target_id ? { resource_id: String(args.target_id) } : {}),
				...(args.restore_image_version !== undefined ? { restore_image_version: Boolean(args.restore_image_version) } : {}),
			};
			return client
				.post(
					`/v1/users/${enc(args.resource_id)}/snapshots/${enc(args.snapshot_id)}/restore`,
					Object.keys(body).length ? body : undefined,
					{ scope: String(args.scope), workspace_id: str(args.workspace_id) },
				)
				.then((r) => {
					if (!r.ok) return fail(r.body);
					const accepted = r.body as { job_id?: string; warning?: string };
					return ok({
						...accepted,
						message: "Restore accepted: it runs in the background and the resource is not restored yet. Follow job_id with get_snapshot_job until status is ready or failed.",
					});
				});
		},
	},
	{
		name: "get_snapshot_job",
		description:
			"Status of a snapshot or restore job of an application or database (`job_id` comes from `restore_snapshot`, from `restore_job_id` when creating an app or database from a snapshot, or from the 202 of `create_snapshot`; to find the jobs of a resource use `list_snapshot_jobs`). `scope` is optional: the job is found by its id; a job of another resource or account is 404 SNAPSHOT_NOT_FOUND. `status`: queued and running are in progress; ready, skipped and failed are final; on failed or skipped, `reason` is the error code and `details` what that code carries (for SNAPSHOT_EXCEEDS_STORAGE: `required_bytes`, `available_bytes`, `required_ram_mb`). While `running` the job has `progress`: `phase` (preparing, copying or finishing), `percent` (0-100, absent when the total size is not known, as in database snapshots), `done_bytes`, `total_bytes` and `eta_seconds` (absent until the rate is stable); `message` sums it up in one line. `resource_id` is the resource the job acts on (for a restore, the target; for a create from a snapshot, the new resource). `wait_seconds` (up to 25) waits for the job to end before answering; without it the call answers at once, so repeat it every few seconds. For a create from a snapshot, a failed restore means the database or image-based app was created EMPTY and kept; a code app is deleted.",
		group: "snapshots",
		scope: "snapshots:read",
		annotations: R,
		inputSchema: {
			scope: optionalScope,
			resource_id,
			job_id: z.string().min(1).describe("The job to read"),
			wait_seconds: z.number().int().min(1).max(25).optional().describe("Wait up to this many seconds for the job to end (max 25)"),
			workspace_id,
		},
		handler: async (args, client) => {
			const followed = await followJob(client, String(args.resource_id), String(args.job_id), str(args.scope), Number(args.wait_seconds ?? 0), str(args.workspace_id));
			if (!followed.ok) return fail(followed.body);
			return ok({ ...followed.job, message: jobMessage(followed.job) });
		},
	},
	{
		name: "list_snapshot_jobs",
		description:
			"Lists the most recent snapshot and restore jobs of an application or database, newest first (`kind`: snapshot or restore; `limit` 1 to 50, default 10). Each job has `id`, `kind`, `status` (queued, running, ready, skipped, failed), `reason` when it ended failed or skipped, and `snapshot_id` once a snapshot job is ready; read one in full with `get_snapshot_job`.",
		group: "snapshots",
		scope: "snapshots:read",
		annotations: R,
		inputSchema: {
			scope,
			resource_id,
			kind: z.enum(["snapshot", "restore"]).optional().describe("Only jobs of this kind (default: both)"),
			limit: z.number().int().min(1).max(50).optional().describe("How many jobs (default 10, max 50)"),
			workspace_id,
		},
		handler: (args, client) =>
			client
				.get(`/v1/users/${enc(args.resource_id)}/snapshots/jobs`, { scope: String(args.scope), kind: str(args.kind), limit: args.limit === undefined ? undefined : Number(args.limit), workspace_id: str(args.workspace_id) })
				.then((r) => respond(r)),
	},
	{
		name: "download_snapshot",
		description: "Downloads a snapshot and writes it to the given path on the computer. The file is written as it arrives (any size), under a temporary name that becomes the final one only when the download ends; an existing file is never overwritten.",
		group: "snapshots",
		route: ["GET", "/v1/users/:id/snapshots/:snapshot_id/download"],
		local: true,
		annotations: R,
		inputSchema: { scope, resource_id, snapshot_id: z.string().min(1), dest: z.string().describe("Path of the file to write"), workspace_id },
		handler: (args, client) =>
			guardLocal(() => downloadToLocal(client, `/v1/users/${enc(args.resource_id)}/snapshots/${enc(args.snapshot_id)}/download`, { scope: String(args.scope), workspace_id: str(args.workspace_id) }, String(args.dest))),
	},
];
