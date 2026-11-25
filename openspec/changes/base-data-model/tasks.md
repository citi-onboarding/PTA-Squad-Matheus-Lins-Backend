## 1. SDD

- [x] 1.1 Record the approved receivable identity and the ERP inspection evidence in the [task](../../../docs/templates/task.md) and the [design](design.md).
- [x] 1.2 Prepare the proposal, design, and scenario deltas for [user accounts](specs/user-accounts/spec.md) and [ERP data synchronization](specs/erp-data-synchronization/spec.md).
- [x] 1.3 Obtain review of the specification and explicit authorization to begin Red.

## 2. Red

- [x] 2.1 Write PostgreSQL integration tests for F02/US-002 from the two delta specs. Cover initial migration from an empty database, generated IDs, account roles and portfolio association, unique keys, receivable ownership and defaults, lookup indexes, integer cents, timestamps, and synchronization run records. Cite the relevant business rules from the scenarios in the tests.
- [x] 2.2 Run the narrowest relevant integration tests and record the expected failures against the current schema.
- [x] 2.3 Explain the planned Green changes in Brazilian Portuguese, then obtain explicit confirmation to proceed.

The focused Red run failed on the absent `User` columns. The full integration file reported 21 expected assertion failures with no baseline migration applied.

## 3. Green

- [x] 3.1 Implement the five models and six enums in `prisma/schema.prisma` with the types, relationships, indexes, and defaults defined in the design.
- [x] 3.2 Generate the additive baseline with `pnpm db:migrate --name base_data_model` and regenerate Prisma Client with `pnpm db:generate`. Inspect the models with `pnpm db:studio` after applying the migration to an empty database.
- [x] 3.3 Re-run the narrow integration tests and record the passing results.
- [x] 3.4 Explain the planned Refactor changes in Brazilian Portuguese, then obtain explicit confirmation to proceed.

Prisma generated and applied `20261125181425_base_data_model` on an empty database. Prisma Studio listed the five tables, and the integration suite passed 21 of 21 tests.

## 4. Refactor

- [x] 4.1 Review the schema and tests for clarity and alignment with both specs. Apply only behavior-preserving refinements and preserve the generated migration history.
- [x] 4.2 Re-run the narrow tests, record the results, and obtain confirmation before advancing to Consolidation.

The suite passed 21 of 21 tests before and after refactoring the test delegates. The schema and migration were preserved.

## 5. Consolidation

- [x] 5.1 Run `pnpm format:check`, `pnpm verify` (including typecheck, tests, and strict OpenSpec validation), `pnpm build`, `pnpm test:coverage`, `pnpm test:integration`, and `pnpm test:container`. Record actual results.
- [x] 5.2 Create `docs/adr/0002-base-data-model.md` from the ADR template, including the approved key, dated ERP inspection evidence and example, and both ERP status mappings. Update the ADR index.
- [x] 5.3 Write `docs/changes/base-data-model.md` from the change template and update the change index as applicable.
- [ ] 5.4 Prepare the pull request with all verification evidence and follow the repository review and CI workflow.

### Final verification evidence

- `pnpm format:check`, `pnpm verify`, and `pnpm build` passed. Verification included typecheck, lint, 40 tests in the default suite, three architecture tests, strict OpenSpec validation (two items), and OpenAPI and skill checks.
- `pnpm test:coverage` passed with 40 tests and 88.23% branch coverage (15 of 17) against the unchanged 85% threshold. The historical baseline result was 76.47% (13 of 17), reproduced on merge base `c0dd1e6`. The params-only middleware test that covered the two additional paths is isolated in commit `fce1e21`.
- `pnpm test:integration` applied the baseline migration to empty PostgreSQL and passed all 21 tests in the final run.
- The task owner reported a passing Docker smoke test for the same application and migration. Docker socket access was unavailable in the final verification environment, so that gate retains its manual evidence.
- The [change summary](../../../docs/changes/base-data-model.md) and [ADR 0002](../../../docs/adr/0002-base-data-model.md) record the completed work. The local branch is `feat/f02-base-data-model`. Pull request publication and CI review remain open.
