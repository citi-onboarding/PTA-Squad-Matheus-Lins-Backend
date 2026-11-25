## Context

See `proposal.md` (Why) for motivation and `specs/erp-data-retrieval/spec.md`
for the required behavior. Current state:

- `src/shared/config/env.ts` parses `process.env` with Zod when the module is
  loaded; `src/server.ts` loads `.env` through `dotenv/config`. Unit and
  integration Vitest configs use `tests/setup-env.ts`, which does not load `.env`.
- No ERP code exists. The ERP contract is published at
  `https://pta-erp-api.onrender.com/openapi.json` (version 3.3.0).
- `vitest.config.ts` enforces 90% line coverage on `src/shared/**`;
  `pnpm test` and `pnpm test:coverage` exclude `*.integration.test.ts`.
- CI runs `pnpm verify` and `pnpm build` only, without an ERP key.

## Goals / Non-Goals

**Goals:**

- One adapter in `src/shared/erp/`, usable by any module without breaking the
  "modules do not import modules" rule.
- Every external dependency (base URL, key, `fetch`, clock/timers) injected or
  controllable from tests, so the retry and pagination logic is testable without
  the network.
- Retry policy isolated from HTTP details so it can be tested with a plain
  failing function and Vitest fake timers.

**Non-Goals:**

- Caching, persistence, scheduling, concurrency of page requests, or circuit
  breaking.
- A generic HTTP client for other integrations.

## Decisions

### D1. Location: `src/shared/erp/`

The adapter is shared infrastructure: the synchronization module now and the
order module later both need it, and modules cannot import each other.
`src/shared` already hosts cross-cutting infrastructure (`config`, `database`,
`http`, `logging`).

- Rejected: a `src/modules/erp` module — other modules could not import it.
- Rejected: duplicating a client per module — divergent retry and validation
  rules against the same rate-limited ERP.

### D2. Factory with injected dependencies

`createErpClient({ baseUrl, apiKey, fetch })` returns
`{ listCustomers, listProducts, listReceivables }`. It never reads `env` or the
global `fetch` itself; the composition root (future sync job) passes
`env.ERP_BASE_URL`, `env.ERP_API_KEY`, and `globalThis.fetch`.

- Rejected: a class with a singleton instance reading `env` — couples the
  adapter to process configuration and makes tests depend on global state.

### D3. Three files with single responsibilities

- `erp-schemas.ts`: Zod schemas and inferred types for `Cliente`, `Produto`,
  `Titulo`, `Problema`, and a generic page envelope (`erpPageSchema(item)`),
  keeping the ERP's Portuguese field names.
- `with-retry.ts`: `withRetry(call, options?)` plus the error types
  (`ErpRequestError` carrying `kind`, optional `status`, `detail`, `erros`, and
  optional `retryAfterSeconds`; `RateLimitedError` carrying
  `retryAfterSeconds`). It decides retry vs. fail only from the error it
  receives; it knows nothing about URLs or pagination.
- `erp-client.ts`: builds URLs and headers, performs one HTTP call per page
  wrapped in `withRetry`, converts every transport failure into an
  `ErpRequestError`, validates the page envelope and then each record, and
  concatenates pages into `{ items, rejected }`.

### D3a. Error classification lives in the client, the decision in `withRetry`

The client translates every failure into one `ErpRequestError` with a `kind`:

| Situation                                      | `kind`      | `status`    | Retried by `withRetry`                                      |
| ---------------------------------------------- | ----------- | ----------- | ----------------------------------------------------------- |
| Non-2xx response (Problem body or not)         | `http`      | HTTP status | 429/503 via `Retry-After`; other 5xx via backoff; 4xx never |
| `fetch` rejects without a response             | `network`   | —           | backoff                                                     |
| 60-second timeout (`TimeoutError`)             | `timeout`   | —           | backoff                                                     |
| 200 with invalid JSON or invalid page envelope | `malformed` | 200         | backoff                                                     |

`withRetry` rethrows anything that is not an `ErpRequestError` immediately, so
programming errors are never retried. `detail` and `erros` are filled only when
the error body parses as a `Problema`; the body itself is never kept.
`Retry-After` is read by the client into `retryAfterSeconds`.

- Rejected: having `withRetry` inspect `Response` objects — couples the retry
  policy to HTTP and makes the required "deliberately failing function" tests
  depend on building fake responses.
- Rejected: retrying every thrown error — a bug would cost 3 extra ERP calls and
  7 seconds before surfacing.

### D3b. Retry budget

At most 4 calls per page request: the initial call plus 3 retries (resolved by
the challenge manager). Server-error backoff waits 1, 2, and 4 seconds; rate
limits wait `Retry-After` (5 s when absent). Both kinds share the same budget,
and the last `ErpRequestError` is rethrown when it is exhausted.

### D4. Retry is applied per page request

A failure on page 3 retries page 3 only, instead of restarting the whole
listing. This keeps the number of ERP requests (and rate-limit consumption)
minimal.

### D5. Timeout with `AbortSignal.timeout(60_000)`

Each `fetch` receives `AbortSignal.timeout(60_000)`; the resulting
`TimeoutError` is classified as retryable like a 5xx. No dependency needed.

- Rejected: a manual `setTimeout` + `AbortController` — more code for the same
  behavior.

### D6. Waiting is injectable

`withRetry` waits through a `sleep` based on `setTimeout`, so Vitest fake timers
control it deterministically (`vi.advanceTimersByTimeAsync`). `Retry-After` is
read as an integer number of seconds; an unparsable or missing value falls back
to 5 seconds.

### D7. Two-level validation: envelope, then record by record

Resolved by the challenge manager. Validation runs in two steps:

1. **Envelope** — `{ dados: unknown[], pagina, tamanho, total, totalPaginas }`
   plus JSON parsing. A failure here means the ERP is misbehaving, so it raises
   `ErpRequestError` of kind `malformed` inside the retried call.
2. **Records** — each element of `dados` is parsed with `safeParse` against its
   entity schema. Valid records go to `items` in their original order. Invalid
   ones go to `rejected` as `{ key, page, issues }`, where `key` is `codigo`
   (customers, products) or `numero` (receivables) when it is a readable
   string/number and `undefined` otherwise, and `issues` holds only Zod `path`
   and `message`. The record's content is never copied into the result.

Each list function returns `ErpListing<T> = { items: T[]; rejected:
ErpRejectedRecord[] }`. The client neither interrupts nor drops invalid records;
deciding what to do with them (keep the last good version, count rejections in
the sync run, fail above 10% per entity, log code and error only) belongs to the
synchronization task.

- Rejected: failing the whole listing on one invalid record — one bad record
  would block every sync until the ERP is fixed.
- Rejected: silently discarding invalid records — the sync could not report or
  measure them.

### D8. Integration tests gated by the key

`erp-client.integration.test.ts` loads `.env` (`dotenv/config`) and uses
`describe.skipIf(!process.env.ERP_API_KEY)`. CI does not define the key, so the
suite is skipped there. The real-ERP calls rely on the existing 120-second
integration timeout to absorb Render's cold start.

### D9. No logging inside the adapter

The adapter does not receive a logger and does not log. Errors carry only the
ERP status, `detail`, and `erros` — never the key, headers, or raw bodies.

## Risks / Trade-offs

- [Render cold start exceeds 60 seconds] → the call times out and is retried
  with backoff; the integration timeout (120 s) leaves room for one retry.
- [Daily rate limit reached during local integration runs] → surfaced as
  `RateLimitedError` instead of waiting; developers rerun later and avoid
  running the suite in loops.
- [Records change between page requests, so the concatenated count differs from
  `total`] → accepted for now; the integration test runs against stable data,
  and the sync task will rely on `atualizadoEm` for consistency.
- [The ERP changes its contract] → every record lands in `rejected` instead of
  reaching credit (RN-01) and price (RN-05) calculations; the sync task fails the
  run above 10% rejections per entity.
- [A Zod issue message could echo record content] → only `path` and `message`
  are kept, and Zod 4 does not include the input value in issues by default.
- [Required `ERP_API_KEY` stops runtimes that do not define it] → those
  runtimes pass a non-secret placeholder (D10, ADR-0002).

## Migration Plan

Not applicable: no database migration and no HTTP contract change. Deploying
requires setting `ERP_BASE_URL` and `ERP_API_KEY` in each environment that
starts the API. Rollback is reverting the change.

## Resolved Decisions

Recorded in `docs/tasks/erp-client.md`. All five pending decisions were
resolved by the challenge manager on 2026-11-24: P1, P3, P4, and P5 are
reflected in D3a, D3b, D7, and the specs (P3 adds the unit test
`src/shared/erp/erp-client.test.ts` with an injected fake `fetch`); P2 is D10.

### D10. Required ERP credentials with placeholders in keyless runtimes

`ERP_BASE_URL` and `ERP_API_KEY` stay required. `docker-compose.yml` uses
`${ERP_API_KEY:-not-configured}` (the developer's `.env` key when present) and
`scripts/test-container.mjs` passes `ERP_API_KEY=not-configured`, both with the
public `ERP_BASE_URL`. Recorded in
`docs/adr/0002-required-erp-credentials.md` because it affects every runtime
that starts the API.

- Rejected: optional key checked only by the future sync — contradicts the
  task's `min(1)` rule and delays a configuration error to the first sync.
- Rejected: real key in every runtime — spreads the secret (RN-14).
