import type { FetchLike } from "../src/client.js";

export interface Call {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: unknown;
}

export interface StubReply {
	status?: number;
	body?: unknown;
	headers?: Record<string, string>;
	binary?: Uint8Array;
}

/** `fetch` falso: devolve a resposta programada e registra o que foi pedido. */
export function stubFetch(replies: StubReply | StubReply[]): { fetch: FetchLike; calls: Call[] } {
	const queue = Array.isArray(replies) ? [...replies] : [replies];
	const calls: Call[] = [];

	const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
		const request = init ?? {};
		calls.push({
			url: String(input),
			method: request.method ?? "GET",
			headers: { ...((request.headers as Record<string, string>) ?? {}) },
			body: request.body,
		});
		const reply = (queue.length > 1 ? queue.shift() : queue[0]) ?? {};
		const status = reply.status ?? 200;
		const payload = reply.binary ?? JSON.stringify(reply.body ?? {});
		return new Response(payload as BodyInit, {
			status,
			headers: { "content-type": "application/json", ...(reply.headers ?? {}) },
		});
	}) as FetchLike;

	return { fetch: fetchImpl, calls };
}

export function parseResult(result: { content: { text: string }[] }): unknown {
	const text = result.content[0]?.text ?? "";
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}
