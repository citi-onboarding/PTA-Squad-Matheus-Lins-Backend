## 1. SDD

- [x] 1.1 Fill in the task template at `docs/tasks/erp-client.md` (F02, US-002)
- [x] 1.2 Write `proposal.md`, `design.md`, and `specs/erp-data-retrieval/spec.md`
- [x] 1.3 Resolve pending decisions P1, P3, P4, and P5 with the challenge manager and update the spec, design, and task file
- [x] 1.4 Run `openspec validate erp-client --strict`

## 2. Red

- [x] 2.1 Developer writes `src/shared/config/env.test.ts` cases for valid, invalid, and missing `ERP_BASE_URL` and `ERP_API_KEY`
- [x] 2.2 Developer writes `src/shared/erp/with-retry.test.ts` with a deliberately failing function and Vitest fake timers: 500 twice then success, 500 always (4 calls, 1/2/4 s), 429 with `Retry-After: 1`, 503 without `Retry-After`, 429 with `Retry-After: 300` and `3600`, 422 not retried, network/timeout/malformed retried, non-ERP errors not retried
- [x] 2.3 Developer writes `src/shared/erp/erp-client.test.ts` with an injected fake `fetch` (no real ERP) covering pagination, `atualizadoDesde`, `X-Api-Key`, a page with one invalid record in the middle, an invalid record without a key, a malformed page, Problem and non-Problem errors, a network failure, and the key never appearing in errors
- [x] 2.4 Developer writes `src/shared/erp/erp-client.integration.test.ts` against the real ERP, gated by `describe.skipIf(!process.env.ERP_API_KEY)`: `items` plus `rejected` match `total`, future `updatedSince` returns empty results, invalid key fails with 401
- [x] 2.5 Run `pnpm test` for the new unit tests and confirm they fail for the expected reasons

## 3. Green

- [x] 3.1 Resolve pending decision P2 (required `ERP_API_KEY` vs. local runtimes)
- [x] 3.2 Add `ERP_BASE_URL` and `ERP_API_KEY` to `src/shared/config/env.ts` and `.env.example`, and adjust local runtimes according to P2
- [x] 3.3 Implement `src/shared/erp/erp-schemas.ts`
- [x] 3.4 Implement `src/shared/erp/with-retry.ts`, `ErpRequestError`, and `RateLimitedError`
- [x] 3.5 Implement `createErpClient` in `src/shared/erp/erp-client.ts`
- [x] 3.6 Run `pnpm test` until every unit test passes
- [x] 3.7 Run `pnpm test:integration` locally with the ERP key in `.env`

## 4. Refactor

- [x] 4.1 Improve naming and remove duplication across the three list functions without changing behavior
- [x] 4.2 Run `pnpm test` and confirm every test stays green

## 5. Consolidation

- [ ] 5.1 Run `pnpm format:check`, `pnpm verify`, `pnpm test:coverage`, and `pnpm build`
- [ ] 5.2 Run `pnpm test:container` if local runtimes changed under P2
- [ ] 5.3 Run `openspec validate erp-client --strict`
- [ ] 5.4 Write `docs/changes/erp-client.md` from `docs/templates/change.md` and evaluate whether an ADR is needed
- [ ] 5.5 Open the pull request from `feat/f02-erp-client` with `citi-prepare-pr`
