---
change_id: base-data-model
date: 2026-11-25
status: in-progress
owners: []
tags: [f02, us-002, prisma, postgresql]
related_adrs: [ADR-0002]
openspec_change: openspec/changes/base-data-model/
---

# Base data model for DistriLux

## Objective

Provide the PostgreSQL foundation for the user seed, ERP data synchronization, and historical data load in F02 (US-002).

## Change made

- Added the `User`, `Customer`, `Product`, `Receivable`, and `SyncRun` models and six enums to the Prisma schema.
- Generated the additive migration `20261125181425_base_data_model` and regenerated Prisma Client.
- Added 21 integration tests against PostgreSQL covering the deployed schema and persistence behavior.

## Resulting behavior

- User accounts have generated IDs, a creation timestamp, unique login emails, and password hashes. Seller accounts can carry a code that matches their customer portfolio.
- Customers and products can be retrieved by ERP code. Duplicate codes are rejected and customer portfolios can be looked up by indexed seller code.
- Valid receivables are accessible from their customer. PostgreSQL rejects unknown customer codes and repeated receivable numbers, including a repeated number with a different installment. The customer lookup is indexed.
- Receivables default to ERP origin. Spreadsheet receivables can omit the ERP order number and ERP update timestamp, and unpaid receivables can omit the payment date.
- Amounts round-trip in integer cents. On supported Prisma writes, the portal's write timestamp advances independently of the ERP update timestamp.
- Run records initialize with a start time, RUNNING status, and zero items read. A finished run retains its result, count, finish time, and any sanitized error.

## Impact

The initial migration adds five tables, their enums, and their indexes and constraints. The existing migration deployment step applies the baseline before dependent features write data. Application rollback can retain the additive tables and migration history. ERP synchronization, user seeding, and historical load remain separate tasks. The HTTP API and OpenAPI contract have no external changes.

ADR 0002 records the approved receivable identity because the uniqueness constraint is a durable data contract shared by ERP synchronization and historical deduplication. Its evidence is limited to the inspected ERP dataset.

## Validations executed

| Command                                                                         | Evidence                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:migrate --name base_data_model`                                        | Created and applied `20261125181425_base_data_model` to an empty PostgreSQL database. Prisma reported that the database was in sync with the schema.                                                                                                                                         |
| `pnpm db:generate`                                                              | Generated Prisma Client 7.10.1.                                                                                                                                                                                                                                                              |
| `pnpm db:studio`                                                                | Listed Customer, Product, Receivable, SyncRun, and User.                                                                                                                                                                                                                                     |
| `pnpm test:integration src/shared/database/base-data-model.integration.test.ts` | Red produced 21 expected assertion failures with the models and migration absent. Green and the final Refactor each reported 21 tests passed after applying the migration to an empty database. A final `pnpm test:integration` run passed all 21 tests against a fresh PostgreSQL database. |
| `pnpm format:check`                                                             | Prettier reported that all matched files use its formatting.                                                                                                                                                                                                                                 |
| `pnpm verify`                                                                   | Typecheck and lint exited successfully. The default suite reported 40 passing tests and the architecture suite reported three. The OpenAPI and skill checks exited successfully.                                                                                                             |
| `pnpm exec openspec validate --all --strict --no-interactive`                   | Two valid items, zero failures.                                                                                                                                                                                                                                                              |
| `pnpm build`                                                                    | Typecheck and TypeScript build exited successfully.                                                                                                                                                                                                                                          |
| `pnpm test:coverage`                                                            | 40 tests passed. Branch coverage was 88.23% (15 of 17), above the unchanged 85% threshold. The prior 76.47% result was reproduced on merge base `c0dd1e6`. Commit `5f311d5` contains the separate middleware test.                                                                           |
| `pnpm test:container`                                                           | The task owner reported that the Docker smoke test passed for the same application and migration. Docker socket access was unavailable during the final recheck.                                                                                                                             |

## Related artifacts

- [Proposal](../../openspec/changes/base-data-model/proposal.md)
- [User accounts specification](../../openspec/changes/base-data-model/specs/user-accounts/spec.md)
- [ERP data synchronization specification](../../openspec/changes/base-data-model/specs/erp-data-synchronization/spec.md)
- [Design](../../openspec/changes/base-data-model/design.md)
- [Tasks and audit evidence](../../openspec/changes/base-data-model/tasks.md)
- [ADR 0002](../adr/0002-base-data-model.md)

## Usage

For local inspection, start PostgreSQL with `docker compose up -d postgres`, configure the local database URL, and run `pnpm db:migrate:deploy` and `pnpm db:studio`.

## Implementation notes

- Prisma manages `syncedAt` via `@updatedAt` for customer, product, and receivable writes.
- Prisma Client 7.10.1 reproduced the tracked generated files byte for byte in a temporary directory. The branch diff reports trailing whitespace only in that generated output.
- The change is active and awaits pull request publication and CI review.
