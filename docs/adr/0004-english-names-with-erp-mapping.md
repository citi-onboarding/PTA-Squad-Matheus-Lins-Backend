---
title: ADR-0004
status: accepted
date: 2026-11-27
owners: [FlavioNorberto]
tags: [f02, erp, persistence, naming]
supersedes: null
superseded_by: null
---

# 0004: English names in the portal, with all ERP conversion in one mapper

## Context

The DistriLux ERP, the system of record (RN-09), names its fields and status
values in Portuguese: `razaoSocial`, `limiteCreditoCentavos`, `vendedor`,
`EM_ABERTO`, `BLOQUEADO`. It also sends date-only values, such as `emissao` and
`vencimento` (`2026-10-05`), next to full date-times with an offset
(`atualizadoEm`). `AGENTS.md` requires code, specifications, and repository
content in English, and the portal data model in `prisma/schema.prisma` already
uses English names (`legalName`, `creditLimitCents`, `sellerCode`).

ADR 0002 fixed the receivable key and the six status mappings (for example
`EM_ABERTO` → `OPEN`) for the future ingestion boundary, but did not decide where
the conversion lives, how fields are renamed, or how date-only values become
instants. The `erp-sync-persist` change is the first code that writes ERP data to
the portal database, so it has to decide that boundary now. Every later feature —
credit (RN-01, RN-03), active customers and products (RN-02, RN-04), table prices
(RN-05), the dashboard, the mobile app, and the churn model — reads these tables
and inherits the decision.

## Decision

- The portal database and all code outside `src/shared/erp/` use English names
  only. ERP Portuguese names exist only in the ERP schemas in
  `src/shared/erp/erp-schemas.ts`, which describe the external contract.
- All conversion from the ERP to the portal model lives in one file,
  `src/modules/erp-sync/erp-sync.mappers.ts` (`toCustomer`, `toProduct`,
  `toReceivable`). No other code renames ERP fields or translates ERP values.
- Status values follow ADR 0002 through exhaustive maps typed from the ERP enums,
  so a new ERP status fails the type check instead of mapping silently.
- Date-only ERP values become midnight in Recife (`T00:00:00-03:00`). Recife has
  no daylight saving time, so the fixed offset is exact. ERP date-times keep their
  own instant.
- Amounts stay integer cents, as the ERP sends them (RN-13).
- Every receivable written from the ERP is marked `source = ERP`.

The field-by-field mapping is recorded in `docs/tasks/erp-sync.md` (Rules and
contract) and tested in `src/modules/erp-sync/erp-sync.test.ts`.

## Consequences

### Positive

- An ERP contract change — a renamed field or a new status — affects one file and
  its tests, not every reader of the database.
- The rest of the code base, the API, and the clients read one consistent English
  vocabulary, as `AGENTS.md` requires.
- Date handling is decided once, so credit and due-date rules never compare an
  ERP date string with a portal instant.

### Negative

- Anyone comparing portal data with the ERP, or reading the database directly,
  needs the name mapping; it lives in the mapper and in the task's contract table.
- Every new ERP field used by the portal needs a schema field, a mapper line, and
  a test.
- The Recife offset is an assumption about the ERP's business day; if the ERP
  ever means another time zone for date-only values, the mapper and its tests
  change.

## Alternatives considered

### Keep the ERP names in the portal database

Store `razaoSocial`, `EM_ABERTO`, and the other ERP names as they arrive. This
would open an exception to the English-only rule in the database and in every
query and API built on it. It would not remove the conversion work either: dates
and status values would still need translating for the portal's rules and
screens, only scattered across features instead of in one place.

### Convert inside each feature that reads ERP data

Let the synchronization store raw values and have each feature translate what it
needs. Rejected because the same mapping would be written several times and could
drift, and because modules cannot import each other to share it.

### Store date-only values as UTC midnight

Simpler, but `2026-10-05T00:00:00Z` is 21:00 on 2026-10-04 in Recife, so due-date
and overdue checks would be off by one day for DistriLux users.

## References

- [ADR 0002: Use the ERP receivable number as the unique key](0002-base-data-model.md)
- [erp-sync-persist design](../../openspec/changes/erp-sync-persist/design.md)
- [ERP data synchronization specification](../../openspec/changes/erp-sync-persist/specs/erp-data-synchronization/spec.md)
- [Change summary](../changes/erp-sync-persist.md)
