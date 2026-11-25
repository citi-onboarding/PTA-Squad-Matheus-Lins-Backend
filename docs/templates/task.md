---
title: F02 — Base Data Model
date: 2026-11-25
owners: []
tags: [f02, us-002, prisma, postgresql]
related_specs: [openspec/specs/backend-foundation/spec.md]
related_adrs: [ADR-0001]
---

# F02 — Base Data Model

## Objective

Define the five base entities for the DistriLux portal and deliver the first PostgreSQL migration for the project. The user seed will depend on `User`, ERP synchronization will write `Customer`, `Product`, and `Receivable`, and the future historical data load will reuse the receivable model. `SyncRun` will hold records of synchronization and historical load runs.

## Scope

### Included

- Define `User`, `Customer`, `Product`, `Receivable`, `SyncRun`, and their six enums in `prisma/schema.prisma`.
- Generate the initial base data model migration and Prisma Client.
- Resolve the receivable identity using authenticated ERP evidence before opening the OpenSpec change.
- In consolidation, write the change summary and ADR 0002 and update the ADR index.

### Out of scope / Non-goals

- User seed and changes to login or authorization behavior.
- ERP client calls in application code, synchronization logic, ERP field conversion, and historical spreadsheet import.
- Orders, contracts, documents, and churn risk.
- New or changed HTTP endpoints.

## Rules and contract

| Item       | Definition                                                                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fields     | Use the field and enum definitions below. Fields are required unless marked optional with `?`.                                                                       |
| Uniqueness | The database enforces uniqueness for `User.email`, `Customer.code`, and `Product.code`. The receivable key is pending (see [Pending decisions](#pending-decisions)). |
| Listing    | Not applicable. The schema includes indexes for future portfolio and receivable lookups.                                                                             |
| Update     | Prisma manages `syncedAt` on customer, product, and receivable writes using `@updatedAt`. Future synchronization and history-load upsert behavior is outside scope.  |
| Deletion   | Not applicable.                                                                                                                                                      |
| Errors     | The database rejects duplicate unique keys and receivables whose `customerCode` refers to a missing customer. HTTP error responses are out of scope.                 |

### Enums

| Enum               | Values                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `Role`             | `SELLER`, `MANAGER`, `FINANCE`, `ADMIN`                                                      |
| `CustomerStatus`   | `ACTIVE`, `BLOCKED`, `INACTIVE` (ERP literals `ATIVO`, `BLOQUEADO`, `INATIVO`, respectively) |
| `ReceivableStatus` | `PAID`, `OPEN`, `OVERDUE` (ERP literals `PAGO`, `EM_ABERTO`, `VENCIDO`, respectively)        |
| `ReceivableSource` | `ERP`, `SPREADSHEET`                                                                         |
| `SyncRunType`      | `ERP_SYNC`, `HISTORY_LOAD`                                                                   |
| `SyncRunResult`    | `RUNNING`, `SUCCESS`, `FAILURE`                                                              |

### Fields

Every model has `id Int @id @default(autoincrement())`.

#### User

| Field          | Type       | Details                                                                              |
| -------------- | ---------- | ------------------------------------------------------------------------------------ |
| `name`         | `String`   | User name.                                                                           |
| `email`        | `String`   | Login identifier, `@unique`.                                                         |
| `passwordHash` | `String`   | Stores the password hash only.                                                       |
| `role`         | `Role`     | User role.                                                                           |
| `sellerCode`   | `String?`  | Only sellers have a code. Matching `Customer.sellerCode` identifies their portfolio. |
| `createdAt`    | `DateTime` | `@default(now())`.                                                                   |

#### Customer

Source endpoint `GET /v1/clientes`.

| Field              | Type             | Details                                                                                                        |
| ------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `code`             | `String`         | ERP customer code such as `C0001`, `@unique`. Future synchronization matches on this code. ERP field `codigo`. |
| `legalName`        | `String`         | Legal name. ERP field `razaoSocial`.                                                                           |
| `cnpj`             | `String`         | Digits only.                                                                                                   |
| `city`             | `String`         | City. ERP field `cidade`.                                                                                      |
| `state`            | `String`         | State abbreviation. ERP field `uf`.                                                                            |
| `segment`          | `String`         | Customer segment. ERP field `segmento`.                                                                        |
| `creditLimitCents` | `Int`            | Credit limit in integer cents. ERP field `limiteCreditoCentavos`.                                              |
| `sellerCode`       | `String`         | ERP seller code. Add `@@index([sellerCode])` for portfolio lookups. ERP field `vendedor`.                      |
| `registeredAt`     | `DateTime`       | Registration date. The ERP supplies a date-only value such as `2021-12-20`. ERP field `dataCadastro`.          |
| `status`           | `CustomerStatus` | Customer status.                                                                                               |
| `erpUpdatedAt`     | `DateTime`       | Time the ERP updated the record. ERP field `atualizadoEm`.                                                     |
| `syncedAt`         | `DateTime`       | Time the portal wrote the record, `@updatedAt`.                                                                |
| `receivables`      | `Receivable[]`   | Reverse side of the relation keyed by customer code.                                                           |

#### Product

Source endpoint `GET /v1/produtos`.

| Field            | Type       | Details                                                           |
| ---------------- | ---------- | ----------------------------------------------------------------- |
| `code`           | `String`   | ERP product code such as `P00001`, `@unique`. ERP field `codigo`. |
| `description`    | `String`   | Product description. ERP field `descricao`.                       |
| `category`       | `String`   | Product category. ERP field `categoria`.                          |
| `unit`           | `String`   | Unit of measure. ERP field `unidade`.                             |
| `listPriceCents` | `Int`      | List price in integer cents. ERP field `precoTabelaCentavos`.     |
| `active`         | `Boolean`  | Product availability status. ERP field `ativo`.                   |
| `erpUpdatedAt`   | `DateTime` | Time the ERP updated the record. ERP field `atualizadoEm`.        |
| `syncedAt`       | `DateTime` | Time the portal wrote the record, `@updatedAt`.                   |

#### Receivable

Source endpoint `GET /v1/titulos`. Historical spreadsheets will also supply records.

| Field            | Type               | Details                                                                                                |
| ---------------- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| `number`         | `Int`              | ERP receivable number. See the pending uniqueness decision. ERP field `numero`.                        |
| `customerCode`   | `String`           | ERP customer code. Add `@@index([customerCode])`. ERP field `cliente`.                                 |
| `customer`       | `Customer`         | Required relation from `Receivable.customerCode` to `Customer.code`.                                   |
| `erpOrderNumber` | `Int?`             | ERP order number. Historical spreadsheet entries may omit it. ERP field `pedidoErp`.                   |
| `installment`    | `String`           | Installment identifier such as `1/3`. ERP field `parcela`.                                             |
| `amountCents`    | `Int`              | Receivable amount in integer cents. ERP field `valorCentavos`.                                         |
| `issuedAt`       | `DateTime`         | Issue date. ERP field `emissao`.                                                                       |
| `dueAt`          | `DateTime`         | Due date. ERP field `vencimento`.                                                                      |
| `paidAt`         | `DateTime?`        | Payment date. Null while unpaid. ERP field `pagamento`.                                                |
| `status`         | `ReceivableStatus` | Payment status.                                                                                        |
| `source`         | `ReceivableSource` | Record origin, `@default(ERP)`.                                                                        |
| `erpUpdatedAt`   | `DateTime?`        | Time the ERP updated the record. Historical spreadsheet entries may omit it. ERP field `atualizadoEm`. |
| `syncedAt`       | `DateTime`         | Time the portal wrote the record, `@updatedAt`.                                                        |

#### SyncRun

| Field        | Type            | Details                                           |
| ------------ | --------------- | ------------------------------------------------- |
| `type`       | `SyncRunType`   | Synchronization or historical load.               |
| `entity`     | `String`        | One of `customers`, `products`, or `receivables`. |
| `startedAt`  | `DateTime`      | `@default(now())`.                                |
| `finishedAt` | `DateTime?`     | Null while the run is in progress.                |
| `result`     | `SyncRunResult` | `@default(RUNNING)`.                              |
| `itemsRead`  | `Int`           | `@default(0)`.                                    |
| `error`      | `String?`       | Error message free of personal data and secrets.  |

## Acceptance criteria

- [ ] Given an empty PostgreSQL database, when the base migration is applied, then it completes without errors and `pnpm db:studio` shows the five models with the fields and enums in this contract.
- [ ] Given the migrated database, when valid records are created with defaulted fields omitted, then each model receives a generated integer ID, `User.createdAt` and `SyncRun.startedAt` are set, `Receivable.source` is `ERP`, and `SyncRun` starts with `RUNNING` and zero items read.
- [ ] Given a stored user email, customer code, or product code, when a second record of the same model uses that value, then the database rejects the duplicate.
- [ ] Given an existing customer, when a receivable is saved with that customer's code, then the relation resolves to that customer and the receivable appears in the customer's related records. Given an unknown code, when a receivable is saved, then the database rejects it.
- [ ] Given the approved receivable key and an existing record, when another record uses the same key, then the database rejects the duplicate. If the approved key is composite, distinct installments with the same number can coexist.
- [ ] Given the applied migration, when the database indexes are inspected, then indexes exist on `Customer.sellerCode` and `Receivable.customerCode`.
- [ ] Given valid records with monetary values, when they are saved and read back, then amounts retain their exact integer cents (for example, 1,234.56 BRL is stored as `123456`) and date fields use the `DateTime` types in the contract.
- [ ] Given an unpaid receivable from a spreadsheet, when a record is stored without an ERP order number, payment date, or ERP update time, then all three values are null and the source is `SPREADSHEET`. Given a running synchronization record, when it is stored without a finish time or an error, then both values are null.
- [ ] Given a customer, product, or receivable, when Prisma creates and then updates the record, then `syncedAt` reflects the most recent write.
- [ ] Given the completed change, when the verification commands in Technical constraints run, then they all pass.

## Technical constraints

- Use Node.js 22, pnpm, Prisma 7, and PostgreSQL. Preserve `pnpm-lock.yaml`.
- Use English for repository content, PascalCase for model and enum names, and camelCase for fields. ERP field conversion belongs to the future synchronization task.
- Store monetary values as `Int` in cents and dates as `DateTime`.
- Start the local PostgreSQL service with `docker compose up -d postgres`. Use the local `DATABASE_URL` documented in `.env.example`.
- Generate the migration under `prisma/migrations/<timestamp>_base_data_model/` with `pnpm db:migrate --name base_data_model`. Keep the generated migration intact and preserve applied migration history.
- Generate Prisma Client with `pnpm db:generate` in `src/shared/database/generated/`. Treat the directory as generated output.
- Follow the SDD and TDD checkpoints in `AGENTS.md`. Run the narrowest relevant test first. Before implementation handoff, run `pnpm format:check`, `pnpm verify`, `pnpm test:coverage`, `pnpm build`, `pnpm test:integration` for the new database constraints, and `pnpm test:container` for migration delivery.
- Use `docs/templates/adr.md` for `docs/adr/0002-base-data-model.md`, update `docs/adr/README.md`, and use `docs/templates/change.md` for the change summary.

## Context and references

- PTA Tech 2026.2, DistriLux. F02 is ERP Data Synchronization (US-002), and this task provides its base data model. Due 2026-11-25. Planned branch `feat/f02-base-data-model`.
- RN-08 defines portfolio access by role. RN-09 makes the ERP the system of record. RN-13 defines integer cents for amounts. RN-14 keeps ERP credentials on the backend. RN-15 governs the future synchronization and its data freshness. RN-16 requires idempotency in the future historical load.
- The existing Prisma schema contains the client generator and PostgreSQL datasource. The [backend foundation specification](../../openspec/specs/backend-foundation/spec.md) covers the existing operational and HTTP behavior. [ADR 0001](../adr/0001-repository-structure.md) establishes backend ownership of ERP synchronization and the historical load.
- [Backend repository](https://github.com/citi-onboarding/PTA-Squad-Matheus-Lins-Backend) and [ERP Swagger UI](https://pta-erp-api.onrender.com/docs/#/).

### Definition of Done

- [ ] Fill the task template and open the OpenSpec change after resolving the pending decision. Obtain OpenSpec instructions before writing each artifact.
- [ ] Confirm the receivable key using authenticated ERP data in Swagger.
- [ ] Create the six enums and five Prisma models.
- [ ] Run `pnpm db:migrate --name base_data_model` and inspect the tables with `pnpm db:studio`.
- [ ] Write ADR 0002 and the summary in `docs/changes/`, and update their indexes as applicable.
- [ ] Prepare and open the pull request using `citi-prepare-pr` and confirm green CI.

## Pending decisions

- [ ] **Receivable identity.** Determine whether ERP `numero` uniquely identifies a receivable across records or can recur across installments.
  - Use `number @unique` if the ERP number is unique across receivables.
  - Use `@@unique([number, installment])` if the number recurs across installments and the pair is unique.
  - The reported Swagger request returned HTTP 401 while the team was waiting for the ERP API key. The response structure and pagination are known. Record uniqueness still requires evidence.
  - The task owner should verify the key with the ERP requirement owner. Once authorized access is available, use Swagger's **Try it out** for `GET /v1/titulos` and compare numbers and installments across pages. Confirm the ERP uniqueness guarantee if sample data alone leaves either option unproven.
  - Record the selected key, a sanitized ERP response example supporting it, and both ERP status-to-enum mappings in ADR 0002. The key will govern future synchronization updates and historical import deduplication. An incorrect key can overwrite installments or create duplicates.
  - Resolve this decision before opening the OpenSpec change or starting implementation.
