## Why

DistriLux needs durable records before the user seed, ERP data synchronization, and historical load can ship. This F02 (US-002) change defines their shared persistence contract so ERP records can be identified consistently and amounts can be stored exactly.

## What Changes

- Add the initial database migration for user accounts, customers, products, receivables, and synchronization and historical load runs.
- Enforce the approved receivable number key, customer and product codes, user email uniqueness, and the required customer–receivable relationship.
- Store monetary values in integer cents and retain timestamps for later freshness tracking.
- Keep user seeding, authentication and authorization behavior, ERP calls and synchronization logic, spreadsheet import, orders, contracts, documents, and churn risk outside this change.

## Capabilities

### New Capabilities

- `user-accounts` covers persisted account identity, roles, and seller portfolio association.
- `erp-data-synchronization` covers persistence of ERP reference data, receivables from both sources, and run records. Execution of synchronization and historical loads is future work.

### Modified Capabilities

## Impact

- Business: The portal can store the reference data needed for portfolios (RN-08), future synchronization (RN-09, RN-15), and historical deduplication (RN-16) while preserving ERP amounts in cents (RN-13).
- Database: One additive PostgreSQL migration and regenerated Prisma Client using existing dependencies.
- API and OpenAPI: No endpoint or contract changes.
- Security: User credentials are represented by password hashes. The model introduces no storage for ERP credentials (RN-14).
- Observability: Synchronization and load runs have a persistence contract for status and sanitized error messages. Application logging and telemetry are outside scope.
- Documentation: Record the migration and validation in the change summary. Record the identity decision, ERP evidence, and status mappings in ADR 0002.
