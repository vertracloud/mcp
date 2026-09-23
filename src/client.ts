/** HTTP client for the Vertra Cloud public API. No authorization logic of its own: the API key decides. */

export const DEFAULT_BASE_URL = "https://api.vertracloud.app";

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
	fetch?: FetchLike;
}

type QueryValue = string | number | boolean | undefined | null;
export type Query = Record<string, QueryValue>;

const TIMEOUT_MS = 30_000;
const BINARY_TIMEOUT_MS = 120_000;

interface RequestInput {
	method: string;
	path: string;
	query?: Query;
	body?: unknown;
	form?: FormData;
	/** Returns the body as a Uint8Array instead of JSON (zip/PEM/CSV download). */
	binary?: boolean;
}

export class VertraClient {
	readonly baseUrl: string;
	private readonly apiKey: string;
	private readonly fetchImpl: FetchLike;

	constructor(apiKey: string, opts: ClientOptions = {}) {
		this.apiKey = apiKey;
		this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
		this.fetchImpl = opts.fetch ?? globalThis.fetch;
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

		let res: Response;
		try {
			res = await this.fetchImpl(this.url(input.path, input.query), {
				method: input.method,
				headers,
				body: payload,
				signal: AbortSignal.timeout(input.binary ? BINARY_TIMEOUT_MS : TIMEOUT_MS),
			});
		} catch (err) {
			const name = err instanceof Error ? err.name : undefined;
			const code = name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR";
			return { ok: false, status: 0, body: { code, message: err instanceof Error ? err.message : String(err) } };
		}

		if (!res.ok) return { ok: false, status: res.status, body: await errorBody(res) };

		if (input.binary) {
			const bytes = new Uint8Array(await res.arrayBuffer());
			return { ok: true, status: res.status, body: bytes as unknown as T };
		}

		const text = await res.text();
		let json: unknown = {};
		try {
			json = text ? JSON.parse(text) : {};
		} catch {
			json = text;
		}
		const unwrapped =
			json && typeof json === "object" && "response" in (json as Record<string, unknown>)
				? (json as Record<string, unknown>).response
				: json;
		return { ok: true, status: res.status, body: unwrapped as T };
	}

	get<T = unknown>(path: string, query?: Query) {
		return this.request<T>({ method: "GET", path, query });
	}
	post<T = unknown>(path: string, body?: unknown, query?: Query) {
		return this.request<T>({ method: "POST", path, body, query });
	}
	put<T = unknown>(path: string, body?: unknown, query?: Query) {
		return this.request<T>({ method: "PUT", path, body, query });
	}
	patch<T = unknown>(path: string, body?: unknown, query?: Query) {
		return this.request<T>({ method: "PATCH", path, body, query });
	}
	delete<T = unknown>(path: string, query?: Query) {
		return this.request<T>({ method: "DELETE", path, query });
	}
	postMultipart<T = unknown>(path: string, form: FormData, query?: Query) {
		return this.request<T>({ method: "POST", path, form, query });
	}
	download(path: string, query?: Query) {
		return this.request<Uint8Array>({ method: "GET", path, query, binary: true });
	}
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
	if (res.status === 429) {
		const header = res.headers.get("retry-after");
		const parsed = header ? Number(header) : Number.NaN;
		if (Number.isFinite(parsed)) body.retry_after = parsed;
		else if (typeof json.retry_after === "number") body.retry_after = json.retry_after;
	} else if (typeof json.retry_after === "number") {
		body.retry_after = json.retry_after;
	}
	return body;
}
