# Contributing

Thanks for your interest. This package is a thin layer over the Vertra Cloud public API: every tool is an HTTP call authenticated with the user's key.

## Running it

```bash
npm install
npm run check   # types
npm test        # vitest
npm run build
```

## Before opening a PR

- A new tool lives in `src/tools/<group>.ts` and is added to the registry in `src/tools/index.ts`; the required scope is **derived** from the route via the `@vertracloud/api-types` scope catalog — don't type the scope by hand.
- Declare `readOnlyHint`, `destructiveHint` and `idempotentHint`. Confirming with the human is the MCP client's job; the server never asks "are you sure?".
- API errors pass through intact (`{ code, message?, details? }`) with `isError: true`.
- No secrets in a tool result. An environment variable's value is never returned.
- After touching the registry, run `npm run docs:tools` to regenerate the README table.
- A bug fix comes with the test that used to fail.

## Tests

`vitest` with `node:assert/strict`. The API is simulated by a `fetch` injected into the client — no test touches the network.
