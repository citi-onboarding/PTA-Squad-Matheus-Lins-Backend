## 1. SDD

- [x] 1.1 Record the approved receivable identity and the ERP inspection evidence in the [task](../../../docs/templates/task.md) and the [design](design.md).
- [x] 1.2 Prepare the proposal, design, and scenario deltas for [user accounts](specs/user-accounts/spec.md) and [ERP data synchronization](specs/erp-data-synchronization/spec.md).
- [ ] 1.3 Obtain review of the specification and explicit authorization to begin Red.

## 2. Red

- [ ] 2.1 Write PostgreSQL integration tests for F02/US-002 from the two delta specs. Cover initial migration from an empty database, generated IDs, account roles and portfolio association, unique keys, receivable ownership and defaults, lookup indexes, integer cents, timestamps, and synchronization run records. Cite the relevant business rules from the scenarios in the tests.
- [ ] 2.2 Run the narrowest relevant integration tests and record the expected failures against the current schema.
- [ ] 2.3 Explain the planned Green changes in Brazilian Portuguese, then obtain explicit confirmation to proceed.

## 3. Green

- [ ] 3.1 Implement the five models and six enums in `prisma/schema.prisma` with the types, relationships, indexes, and defaults defined in the design.
- [ ] 3.2 Generate the additive baseline with `pnpm db:migrate --name base_data_model` and regenerate Prisma Client with `pnpm db:generate`. Inspect the models with `pnpm db:studio` after applying the migration to an empty database.
- [ ] 3.3 Re-run the narrow integration tests and record the passing results.
- [ ] 3.4 Explain the planned Refactor changes in Brazilian Portuguese, then obtain explicit confirmation to proceed.

## 4. Refactor

- [ ] 4.1 Review the schema and tests for clarity and alignment with both specs. Apply only behavior-preserving refinements and preserve the generated migration history.
- [ ] 4.2 Re-run the narrow tests, record the results, and obtain confirmation before advancing to Consolidation.

## 5. Consolidation

- [ ] 5.1 Run `pnpm format:check`, `pnpm verify` (including typecheck, tests, and strict OpenSpec validation), `pnpm build`, `pnpm test:coverage`, `pnpm test:integration`, and `pnpm test:container`. Record actual results.
- [ ] 5.2 Create `docs/adr/0002-base-data-model.md` from the ADR template, including the approved key, dated ERP inspection evidence and example, and both ERP status mappings. Update the ADR index.
- [ ] 5.3 Write `docs/changes/base-data-model.md` from the change template and update the change index as applicable.
- [ ] 5.4 Prepare the pull request with all verification evidence and follow the repository review and CI workflow.
