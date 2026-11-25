## Context

The existing Prisma 7 schema configures the PostgreSQL datasource and generated client. It contains no models. See [proposal.md](proposal.md) for the motivation and scope.

## Goals / Non-Goals

**Goals**

- Use one additive baseline migration and preserve the existing Prisma client generation path.
- Make identity and required customer references enforceable by PostgreSQL for all writers.

**Non-Goals**

- Add new dependencies, establish new module dependencies, or introduce an HTTP persistence interface.
- Implement ERP normalization, write-time business workflows, or the live API integration.

## Decisions

### Use the ERP receivable number as the unique key

Use `number Int @unique` and keep `installment` as a required string. The composite alternative `@@unique([number, installment])` would allow a repeated number with a different installment, contrary to the approved portal identity. A key based on `erpOrderNumber` would also exclude spreadsheet records that lack an ERP order number.

The approved identifier is `number Int @unique`. On 2026-11-25, an authenticated, unfiltered inspection of `GET /v1/titulos` traversed all 10 pages with up to 50 records per page. The API reported 467 records and the inspection covered all 467. It found 467 distinct numbers and zero duplicate numbers, and 467 distinct number/installment pairs and zero duplicate pairs.

| `numero` | `pedidoErp` | `parcela` |
| -------- | ----------- | --------- |
| 901920   | 43888       | 1/3       |
| 901921   | 43888       | 2/3       |
| 901922   | 43888       | 3/3       |

The example shows separate receivable numbers for three installments of one ERP order. The inspection supports the portal's database constraint using the data available on that date. A formal ERP guarantee of future uniqueness remains unverified. ADR 0002 will record this evidence, the approved key, and the [ERP status mappings](#enums).

### Enforce stable references and preserve source values

Use a foreign key from `Receivable.customerCode` to the unique `Customer.code`. A reference to the generated customer ID would require future ERP writers to translate the ERP code before storing a receivable. Add indexes to `Customer.sellerCode` and `Receivable.customerCode` for portfolio and relationship lookups. Keep the account seller code as an optional portfolio identifier because multiple customers can share it.

Use integer cents throughout. Float and Decimal would diverge from the ERP integer-cent input contract. Keep ERP update timestamps separate from the portal write timestamp, which Prisma sets through `@updatedAt`. Source-specific date parsing belongs to future writers.

### Use the existing database infrastructure

Add models to `prisma/schema.prisma` and use the existing client output under `src/shared/database/generated/`. The new persistence contract needs only the existing database setup. The account seller-code convention, CNPJ format, run entity labels, and safe run error text describe valid values for future writers. The requested database enforcement consists of types, defaults, constraints for uniqueness and the customer reference, and lookup indexes.

## Prisma model contract

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
| `number`         | `Int`              | ERP receivable number, `@unique`. ERP field `numero`.                                                  |
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

## Risks / Trade-offs

- A later ERP dataset may contain duplicate numbers → PostgreSQL rejects the conflicting write. Reassess the identity contract with the ERP owner if later evidence contradicts the approved key, and use an additive follow-up migration if required.
- Receivables depend on existing customers → Database constraints prevent orphan records. Future writers must have the referenced customers available before inserting receivables.
- The same key will be used for historical deduplication → Keep the ERP as the system of record (RN-09). Reconciliation behavior belongs to the historical load change.

## Migration Plan

1. Start local PostgreSQL with `docker compose up -d postgres` and use the local database URL from `.env.example`.
2. Generate the initial migration with `pnpm db:migrate --name base_data_model` and the client with `pnpm db:generate`. Review the generated migration for additive operations and verify it from an empty PostgreSQL database, including inspection through `pnpm db:studio`.
3. Deploy through the existing migration deployment command, `pnpm db:migrate:deploy`, and verify the migrated schema before dependent features write to it.
4. If application rollback is needed, revert the application release and retain the additive tables and migration history. Address schema issues through a corrective migration.
