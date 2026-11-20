/** HTTP client for the Vertra Cloud public API. No authorization logic of its own: the API key decides. */

export const DEFAULT_BASE_URL = "https://api.vertracloud.app";
/** Blob Storage API base URL, including `/v1`. */
export const DEFAULT_BLOB_BASE_URL = "https://blob.vertracloud.app/v1";

/** API error envelope (`{ code, message?, details? }`), plus whatever else is useful to the agent. */
export interface ApiErrorBody {
	code: string;
	message?: string;
	details?: unknown;
	/** Seconds until the request can be retried; filled from the header on a 429. */
	retry_after?: number;
}

export interface ApiResult<T = unknown> {
	ok: boolean;
	status: number;
	body: T | ApiErrorBody;
}

export type FetchLike = typeof globalThis.fetch;

export interface ClientOptions {
	baseUrl?: string;
	blobBaseUrl?: string;
	fetch?: FetchLike;
	/** Milliseconds without receiving a byte before a binary download is given up. The clock restarts on every chunk. Default 60 s. */
	downloadInactivityMs?: number;
}

type QueryValue = string | number | boolean | undefined | null;
export type Query = Record<string, QueryValue>;

const TIMEOUT_MS = 30_000;
/** A binary download has no total deadline: this one covers only the wait for the response headers. */
const BINARY_HEADERS_TIMEOUT_MS = 120_000;
const DOWNLOAD_INACTIVITY_MS = 60_000;
/** For the routes that may wait on a snapshot (up to ~90 s on the server). */
export const SNAPSHOT_TIMEOUT_MS = 120_000;

/** Where a streamed download goes: each chunk is handed over as it arrives, so memory does not grow with the file. */
export interface DownloadSink {
	write(chunk: Uint8Array): Promise<void>;
}

interface RequestInput {
	method: string;
	path: string;
	query?: Query;
	body?: unknown;
	form?: FormData;
	/** Returns the body as a Uint8Array instead of JSON (zip/PEM/CSV download). */
	binary?: boolean;
	/** Extra request headers (for example `Idempotency-Key`); never `Authorization`. */
	headers?: Record<string, string>;
	/** With `binary`: the body is written to this sink chunk by chunk instead of being returned (the result body is `{ bytes }`). */
	sink?: DownloadSink;
	/** Overrides the default timeout of this call (for a binary one, the wait for the headers). */
	timeoutMs?: number;
	/** Cancels the call, including a download in progress. */
	signal?: AbortSignal;
}

export class VertraClient {
	readonly baseUrl: string;
	private readonly apiKey: string;
	private readonly fetchImpl: FetchLike;
	private readonly blobBaseUrl: string;
	private readonly downloadInactivityMs: number;

	constructor(apiKey: string, opts: ClientOptions = {}) {
		this.apiKey = apiKey;
		this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
		this.fetchImpl = opts.fetch ?? globalThis.fetch;
		this.blobBaseUrl = (opts.blobBaseUrl ?? DEFAULT_BLOB_BASE_URL).replace(/\/+$/, "");
		this.downloadInactivityMs = opts.downloadInactivityMs ?? DOWNLOAD_INACTIVITY_MS;
	}

	/** Same key and fetch, pointed at the Blob Storage host. Tool paths are then `/objects`, `/stats`, ... */
	blobClient(): VertraClient {
		return new VertraClient(this.apiKey, { baseUrl: this.blobBaseUrl, fetch: this.fetchImpl, downloadInactivityMs: this.downloadInactivityMs });
	}

	private url(path: string, query?: Query): string {
		// `path` is always a literal from the package itself; it never comes from the agent.
		const url = new URL(this.baseUrl + path);
		for (const [key, value] of Object.entries(query ?? {})) {
			if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
		}
		return url.toString();
	}

	async request<T = unknown>(input: RequestInput): Promise<ApiResult<T>> {
		const headers: Record<string, string> = {
			...input.headers,
			Authorization: `Bearer ${this.apiKey}`,
			"User-Agent": "vertracloud-mcp",
		};

		let payload: BodyInit | undefined;
		if (input.form) {
			payload = input.form;
		} else if (input.body !== undefined) {
			headers["Content-Type"] = "application/json";
			payload = JSON.stringify(input.body);
		}

		// A binary route has no total deadline (a large file takes as long as it takes): one timer covers the wait for the
		// headers and, while the body arrives, an inactivity timer restarts on every chunk.
		const controller = new AbortController();
		const onCallerAbort = () => controller.abort(input.signal?.reason);
		if (input.signal?.aborted) controller.abort(input.signal.reason);
		else input.signal?.addEventListener("abort", onCallerAbort, { once: true });
		let timer: ReturnType<typeof setTimeout> | undefined;
		const abortAfter = (ms: number, message: string) => {
			clearTimeout(timer);
			timer = setTimeout(() => controller.abort(new DOMException(message, "TimeoutError")), ms);
		};
		const disarm = () => clearTimeout(timer);
		if (input.binary) {
			abortAfter(input.timeoutMs ?? BINARY_HEADERS_TIMEOUT_MS, "The API did not answer in time.");
		} else {
			const total = AbortSignal.timeout(input.timeoutMs ?? TIMEOUT_MS);
			total.addEventListener("abort", () => controller.abort(total.reason), { once: true });
		}

		try {
			let res: Response;
			try {
				res = await this.fetchImpl(this.url(input.path, input.query), {
					method: input.method,
					headers,
					body: payload,
					// The API never redirects; following one would send the Bearer key to another host.
					redirect: "error",
					signal: controller.signal,
				});
			} catch (err) {
				return networkError(err, input.signal);
			}

			if (!res.ok) return { ok: false, status: res.status, body: await errorBody(res) };

			if (input.binary) {
				const arm = () => abortAfter(this.downloadInactivityMs, `No data received for ${Math.round(this.downloadInactivityMs / 1000)} s; the download stopped.`);
				const sink = input.sink;
				if (sink) {
					let written = 0;
					let sinkFailure: { error: unknown } | undefined;
					try {
						await readBody(res, arm, disarm, async (chunk) => {
							try {
								await sink.write(chunk);
							} catch (error) {
								sinkFailure = { error };
								throw error;
							}
							written += chunk.byteLength;
						});
						return { ok: true, status: res.status, body: { bytes: written } as unknown as T };
					} catch (err) {
						if (sinkFailure) throw sinkFailure.error;
						return networkError(err, input.signal);
					}
				}
				try {
					const chunks: Uint8Array[] = [];
					await readBody(res, arm, disarm, async (chunk) => void chunks.push(chunk));
					return { ok: true, status: res.status, body: concat(chunks) as unknown as T };
				} catch (err) {
					return networkError(err, input.signal);
				}
			}

			const text = await res.text();
			let json: unknown = {};
			try {
				json = text ? JSON.parse(text) : {};
			} catch {
				json = text;
			}
			const envelope = json && typeof json === "object" ? (json as Record<string, unknown>) : undefined;
			const unwrapped = envelope && "response" in envelope ? envelope.response : json;
			return { ok: true, status: res.status, body: unwrapped as T };
		} finally {
			clearTimeout(timer);
			input.signal?.removeEventListener("abort", onCallerAbort);
		}
	}

	get<T = unknown>(path: string, query?: Query) {
		return this.request<T>({ method: "GET", path, query });
	}
	post<T = unknown>(path: string, body?: unknown, query?: Query, headers?: Record<string, string>, timeoutMs?: number) {
		return this.request<T>({ method: "POST", path, body, query, headers, timeoutMs });
	}
	put<T = unknown>(path: string, body?: unknown, query?: Query) {
		return this.request<T>({ method: "PUT", path, body, query });
	}
	patch<T = unknown>(path: string, body?: unknown, query?: Query) {
		return this.request<T>({ method: "PATCH", path, body, query });
	}
	delete<T = unknown>(path: string, query?: Query, timeoutMs?: number) {
		return this.request<T>({ method: "DELETE", path, query, timeoutMs });
	}
	postMultipart<T = unknown>(path: string, form: FormData, query?: Query) {
		return this.request<T>({ method: "POST", path, form, query });
	}
	/** The body is the file (`Uint8Array`), whole in memory: only for small files (a certificate). No total deadline: it is given up only after `downloadInactivityMs` without data. */
	download(path: string, query?: Query) {
		return this.request<Uint8Array>({ method: "GET", path, query, binary: true });
	}
	/** Streams the file to `sink` as it arrives (memory constant, whatever the size). Same deadlines as `download`; the result body is `{ bytes }`. A failure of the sink is thrown, not returned. */
	downloadInto(path: string, query: Query | undefined, sink: DownloadSink, signal?: AbortSignal) {
		return this.request<{ bytes: number }>({ method: "GET", path, query, binary: true, sink, signal });
	}
}

function networkError(err: unknown, callerSignal: AbortSignal | undefined): ApiResult<never> {
	const name = err instanceof Error ? err.name : undefined;
	const cause = err instanceof Error ? err.cause : undefined;
	if (/redirect/i.test(`${err instanceof Error ? err.message : ""} ${cause instanceof Error ? cause.message : String(cause ?? "")}`)) {
		return {
			ok: false,
			status: 0,
			body: { code: "UNEXPECTED_REDIRECT", message: "The API answered with a redirect, which is refused so the API key is never sent to another address. Check the configured base URL." },
		};
	}
	if (callerSignal?.aborted) return { ok: false, status: 0, body: { code: "ABORTED", message: "The request was cancelled." } };
	const code = name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR";
	return { ok: false, status: 0, body: { code, message: err instanceof Error ? err.message : String(err) } };
}

/**
 * Reads the body chunk by chunk, handing each to `onChunk`. `arm()` starts the inactivity timer before every read and `disarm()` stops it once
 * the chunk is in, so a slow consumer (the disk) is not counted as a stalled download.
 */
async function readBody(res: Response, arm: () => void, disarm: () => void, onChunk: (chunk: Uint8Array) => Promise<void>): Promise<void> {
	const reader = res.body?.getReader();
	if (!reader) {
		await onChunk(new Uint8Array(await res.arrayBuffer()));
		return;
	}
	try {
		for (;;) {
			arm();
			const { done, value } = await reader.read();
			disarm();
			if (done) return;
			await onChunk(value);
		}
	} catch (error) {
		await reader.cancel(error).catch(() => undefined);
		throw error;
	}
}

function concat(chunks: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

async function errorBody(res: Response): Promise<ApiErrorBody> {
	const text = await res.text().catch(() => "");
	let json: Record<string, unknown> = {};
	try {
		json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
	} catch {
		// non-JSON body: falls through to the fallback below
	}
	const body: ApiErrorBody = {
		code: typeof json.code === "string" ? json.code : `HTTP_${res.status}`,
		message: typeof json.message === "string" ? json.message : res.statusText || undefined,
	};
	if (json.details !== undefined) body.details = json.details;
	const detailsRetryAfter =
		typeof json.details === "object" && json.details !== null ? (json.details as Record<string, unknown>).retry_after : undefined;
	if (res.status === 429) {
		const header = res.headers.get("retry-after");
		const parsed = header ? Number(header) : Number.NaN;
		if (Number.isFinite(parsed)) body.retry_after = parsed;
		else if (typeof json.retry_after === "number") body.retry_after = json.retry_after;
		else if (typeof detailsRetryAfter === "number") body.retry_after = detailsRetryAfter;
	} else if (typeof json.retry_after === "number") {
		body.retry_after = json.retry_after;
	}
	return body;
}
