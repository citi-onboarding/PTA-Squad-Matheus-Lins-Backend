---
change_id: erp-client
date: 2026-11-24
status: in-progress
owners: [FlavioNorberto]
tags: [F02, US-002, erp, shared]
related_adrs: [ADR-0002]
openspec_change: openspec/changes/erp-client/
---

# ERP HTTP client

## Objective

Give the backend one validated, rate-limit-aware way to read customers,
products, and receivables from the DistriLux ERP, so the F02 synchronization
(US-002) and, later, order submission never call the ERP directly.

## Change made

- `src/shared/erp/` adapter, shared because modules cannot import each other:
  - `erp-schemas.ts`: Zod schemas for `Cliente`, `Produto`, `Titulo`,
    `Problema`, and the page envelope, keeping the ERP's Portuguese field names.
  - `erp-errors.ts`: `ErpRequestError` (`kind`, `status`, `detail`, `erros`,
    `retryAfterSeconds`) and `RateLimitedError` (`retryAfterSeconds`).
  - `with-retry.ts`: `withRetry`, the retry policy, independent of HTTP.
  - `erp-client.ts`: `createErpClient({ baseUrl, apiKey, fetch })` with
    `listCustomers`, `listProducts`, and `listReceivables`.
- `ERP_BASE_URL` and `ERP_API_KEY` added to the validated environment and to
  `.env.example`; `docker-compose.yml` and `scripts/test-container.mjs` pass a
  non-secret placeholder key (ADR-0002).
- Unit tests use fixed ERP values from `vitest.config.ts` instead of the shared
  setup file, so the real-ERP integration suite still skips without a key.
- Refactor: the error types moved to `erp-errors.ts`, the three routes became a
  resource table, and record validation was split from pagination, with no
  change in behavior, public contract, or test assertions.

## Resulting behavior

- Each list function reads every page (`tamanho=50`, page 1 to `totalPaginas`),
  sends `X-Api-Key` on every request and `atualizadoDesde` when `updatedSince`
  is given, and returns `{ items, rejected }`.
- Records are validated one by one: valid ones go to `items` in ERP order;
  invalid ones go to `rejected` with `key` (`codigo` or `numero` when readable),
  `page`, and Zod `issues` (`path`, `message`), never the record content.
- Each call times out after 60 seconds and is made at most 4 times.
- 429/503 wait `Retry-After` seconds (5 s when absent); `Retry-After` above
  300 s throws `RateLimitedError` immediately.
- Other 5xx (including non-Problem bodies such as an HTML 502), timeouts,
  network failures, and malformed pages are retried after 1, 2, and 4 seconds;
  only the failing page is retried.
- 401, 422, and other 4xx fail immediately with `status`, `detail`, and
  `erros`; errors never contain the API key.
- The API refuses to start without a valid `ERP_BASE_URL` and a non-empty
  `ERP_API_KEY`.

## Impact

- No HTTP endpoint, OpenAPI, or database change.
- Every runtime that starts the API must define `ERP_BASE_URL` and
  `ERP_API_KEY` (ADR-0002).
- Against the real ERP on 2026-11-24: 120 customers, 60 products, and 456
  receivables, all valid (0 rejected).
- Deciding what to do with rejected records (keep the last good version, count
  them in the sync run, fail above 10% per entity) belongs to the next F02 task.

## Validations executed

Run on 2026-11-24 and 2026-11-25 on the developer's machine (Windows, Node 24),
after switching the local checkout to LF line endings
(`git config --local core.autocrlf input`; content unchanged).

| Command                                    | Result                                                                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                | 11 files, 75 tests passed                                                                                                  |
| `pnpm test:integration` (with the ERP key) | 9 passed against the real ERP (~36 s)                                                                                      |
| `pnpm test:integration` (without the key)  | 9 skipped, as in CI                                                                                                        |
| `pnpm test:coverage`                       | passed; 97.85% lines, 91.54% branches; `shared/erp` 100% lines                                                             |
| `pnpm typecheck`, `pnpm lint`              | passed                                                                                                                     |
| `pnpm test:architecture`                   | passed                                                                                                                     |
| `openspec validate erp-client --strict`    | valid (`pnpm spec:validate`: 2 passed)                                                                                     |
| `pnpm skills:check`                        | passed                                                                                                                     |
| `pnpm build`                               | passed                                                                                                                     |
| `pnpm verify`                              | passed (typecheck, lint, 75 unit tests, architecture, OpenSpec, `openapi:check`, skills)                                   |
| `pnpm format:check`                        | passed for every repository file; the only warning is the developer's untracked, non-committed `.vscode/settings.json`     |
| `pnpm test:container`                      | passed: image built, migrations applied, container started with `ERP_API_KEY=not-configured` and answered its health check |

## Related artifacts

- Task: `docs/tasks/erp-client.md`
- Proposal: `openspec/changes/erp-client/proposal.md`
- Specification: `openspec/changes/erp-client/specs/erp-data-retrieval/spec.md`
- Design: `openspec/changes/erp-client/design.md`
- Tasks: `openspec/changes/erp-client/tasks.md`
- ADR: `docs/adr/0002-required-erp-credentials.md`

## Usage

```ts
import { env } from "../shared/config/env.js";
import { createErpClient } from "../shared/erp/erp-client.js";
import { RateLimitedError } from "../shared/erp/erp-errors.js";

const erp = createErpClient({
  baseUrl: env.ERP_BASE_URL,
  apiKey: env.ERP_API_KEY,
  fetch,
});

const { items, rejected } = await erp.listCustomers({
  updatedSince: "2026-11-23T12:00:00-03:00",
});
// Catch RateLimitedError to reschedule when the daily limit is reached.
```

To run the real-ERP tests, put the key from the PM in the git-ignored `.env`
(`ERP_API_KEY=...`) and run `pnpm test:integration`.

## Implementation notes

- `Retry-After` is read as whole seconds; any other format falls back to 5 s.
- Running the integration file through the unit config (for example
  `vitest run src/shared/erp`) uses the unit placeholder key and fails with
  401; use `pnpm test` and `pnpm test:integration`.
- Records changing between page requests can make `items + rejected` differ
  from `total`; the sync task relies on `atualizadoEm` for consistency.
