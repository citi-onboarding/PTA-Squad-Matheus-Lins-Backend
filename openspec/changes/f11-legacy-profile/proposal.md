## Why

The order and receivable history before October 2026 exists only in three hand-filled spreadsheets (`Clientes - Comercial.xlsx`, `Pedidos 2025-2026 - Comercial.xlsx`, and `titulos.csv`). They contain duplicates, mixed date and money formats, customers and sellers written by name, wrong quantities, total rows, and values that disagree with the ERP (PRD 7.4). The sprint 2 history load (F11, US-011) and the churn features (F26, US-026) both depend on this data. Before writing any load, the team needs to know which problems exist, how often, and how each one will be treated, following RN-09 (the ERP wins) and RN-16 (every correction and discard is recorded with its reason).

## What Changes

- Add a reproducible first read ("profile") of the three original files that never edits, converts, or rewrites them.
- Measure, per file: rows, columns, and column types; date, money, and status formats; exact and key duplicates; name-based customer and seller references and codes outside the ERP pattern (`C0001`, `P00001`); suspicious quantities, total rows, cancelled orders, and reversed receivables; and how many customer codes, product codes, and October 2026 receivables also exist in the ERP.
- For each problem, report the count, one real example identified only by codes, and the proposed rule: correct, discard with reason, or send to pending.
- Reconcile every file: rows read = rows without problems + rows with at least one problem.
- Add a one-off export of ERP customers, products, and receivables to local files for the cross-check, using the team key from the server environment.
- Publish the result as `docs/data/legacy-spreadsheets-profile.md`, including a recommendation (not a decision) on whether the sprint 2 load runs in TypeScript (`history-load` module) or in Python (`ml/`).
- Define the first layout of `ml/`: pinned Python dependencies and setup instructions.

## Capabilities

### New Capabilities

- `legacy-history`: profiling of the legacy spreadsheets: problem detection, proposed treatment rules, ERP cross-check, reconciliation of row counts, and privacy of the published report.

### Modified Capabilities

None.

## Impact

- **Business**: gives the sprint 2 load a measured, reviewed rule for each data problem, so the dashboard and churn model are built on history the team understands (US-011, US-013, US-015, US-026).
- **API**: none. No route, schema, or OpenAPI change.
- **Database and migrations**: none. Nothing is written to the portal database in this change.
- **Security and privacy**: the original files contain CNPJs and contact names, so they stay out of Git (`ml/data/raw/` is ignored). The published report shows only codes, never CNPJ or contact names. The ERP key is read from the server environment and never written to files or logs (RN-14). The notebook is committed without outputs.
- **ERP usage**: the export reads paginated lists once and honors `Retry-After` on 429 and 503 responses (RN-15).
- **Observability**: not applicable; this is an offline analysis, not a running service.
- **Documentation**: new `docs/data/legacy-spreadsheets-profile.md`; `ml/README.md` gains the environment setup.
- **Dependencies**: Python only, pinned in `ml/requirements.txt` (pandas, openpyxl, jupyter, pytest). The Node.js dependencies and build do not change.

### In scope

- Reading and measuring the three original files and the ERP export.
- Proposed treatment rule for each problem found.
- The report and the `ml/` environment setup.

### Out of scope

- Writing the history to the database (sprint 2 load, US-011).
- The load report for the administrator (F12, US-012).
- Churn features and model (F26).
- Deciding the language of the sprint 2 load; this change only records a recommendation.
- Running Python tests in CI.
