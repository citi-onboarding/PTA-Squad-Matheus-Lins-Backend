---
title: ADR-0002
status: accepted
date: 2026-11-25
owners: []
tags: [f02, persistence, erp]
supersedes: null
superseded_by: null
---

# 0002: Use the ERP receivable number as the unique key

## Context

F02 (US-002) establishes the PostgreSQL data model for DistriLux. Future ERP synchronization must update the same receivable reliably, and the historical spreadsheet load will reuse its identity to avoid duplicates (RN-09, RN-15, RN-16). Separate installments of an order must remain individually addressable. Historical rows can omit the ERP order number.

On 2026-11-25, the task owner authenticated to `GET /v1/titulos` and inspected all 10 pages without filters, with up to 50 records per page. The API reported 467 records and all 467 were inspected. There were 467 distinct numbers and zero duplicate numbers, as well as 467 distinct number/installment pairs and zero duplicate pairs.

The following response excerpt shows three installment numbers for one order.

| `numero` | `pedidoErp` | `parcela` |
| -------- | ----------- | --------- |
| 901920   | 43888       | 1/3       |
| 901921   | 43888       | 2/3       |
| 901922   | 43888       | 3/3       |

## Decision

Use `Receivable.number Int @unique` as the portal's unique key for receivables from either source. Persist the ERP `numero` in this field and retain `installment` separately as a required string. Keep the required customer reference keyed by `Customer.code`. The synchronization and historical load will use the receivable key for matching when those features are implemented.

Use the following status mappings at the future ERP ingestion boundary.

| Model        | ERP status  | Prisma enum        | Prisma value |
| ------------ | ----------- | ------------------ | ------------ |
| `Customer`   | `ATIVO`     | `CustomerStatus`   | `ACTIVE`     |
| `Customer`   | `BLOQUEADO` | `CustomerStatus`   | `BLOCKED`    |
| `Customer`   | `INATIVO`   | `CustomerStatus`   | `INACTIVE`   |
| `Receivable` | `PAGO`      | `ReceivableStatus` | `PAID`       |
| `Receivable` | `EM_ABERTO` | `ReceivableStatus` | `OPEN`       |
| `Receivable` | `VENCIDO`   | `ReceivableStatus` | `OVERDUE`    |

## Consequences

### Positive

- PostgreSQL rejects a second record with the same number, including a record with a different installment value.
- Distinct installment numbers for one ERP order can coexist. The key also works for historical rows that lack an ERP order number.

### Negative

- The full inspection covers the dataset reported on 2026-11-25. A formal ERP guarantee of future uniqueness remains unverified.
- If the ERP later emits the same number for different receivables, PostgreSQL will reject the conflicting insert. Reassess the key with the ERP owner using that evidence and use a corrective migration if the data contract changes.

## Alternatives considered

### Use the number and installment as a composite key

`@@unique([number, installment])` would allow one number to identify multiple records when the installment values differ. The complete inspection found no repeated numbers, and the approved portal contract identifies each installment by its own receivable number.

### Use the ERP order number and installment

An order can have multiple installments, and historical spreadsheet rows may omit the ERP order number. The order-based key would leave those historical rows without a stable identity.

## References

- [Base data model design and ERP inspection evidence](../../openspec/changes/base-data-model/design.md#use-the-erp-receivable-number-as-the-unique-key)
- [ERP data synchronization specification](../../openspec/changes/base-data-model/specs/erp-data-synchronization/spec.md)
- [Base data model change summary](../changes/base-data-model.md)
