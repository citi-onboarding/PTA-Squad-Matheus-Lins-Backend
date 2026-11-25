---
change_id: f11-legacy-profile
date: 2026-11-25
status: in-progress
owners: [thiagoac07]
tags: [f11, us-011, data, legacy-history]
related_adrs: []
openspec_change: openspec/changes/f11-legacy-profile/
---

# First read of the legacy spreadsheets

## Objective

Measure every data problem in the three legacy spreadsheets (`Clientes - Comercial.xlsx`, `Pedidos 2025-2026 - Comercial.xlsx`, `titulos.csv`) and propose how the sprint 2 history load treats each one, following RN-09 and RN-16 (F11, US-011).

## Change made

- **Tested package** `ml/legacy_profile/` that measures the problems without changing the files:
  - text readers with header detection by row;
  - format classifiers for dates, money, installments, and codes;
  - duplicate, reference, and anomaly detectors;
  - ERP cross-check;
  - report assembly with a fixed rule table, row reconciliation, and a CNPJ privacy guard.
- **ERP export** `ml/scripts/export_erp.py`: reads customers, products, and receivables page by page with the team key from `ERP_API_KEY`, and honors `Retry-After` on 429 and 503.
- **Notebook** `ml/notebooks/01-legacy-profile.ipynb`: only calls the package on the real files; committed without outputs.
- **Report** `docs/data/legacy-spreadsheets-profile.md`: per file, the counts, code-only examples, proposed treatments, reconciliation, ERP cross-check, evidence for the rules, seller mapping, open questions, and a recommendation (not a decision) for the sprint 2 load.
- **`ml/` layout and setup**: `ml/requirements.txt` with pinned versions, `ml/pytest.ini`, and the setup in `ml/README.md`.
- **Repository settings**: `.gitignore` excludes `ml/data/raw/`, the virtual environment, and Python caches. `eslint.config.mjs` ignores `ml/.venv/**`, because Jupyter installs JavaScript files there that ESLint would otherwise lint.
- **Spec updates after the first read**: the spec gained scenarios for title blocks above the header, dotted dates, `20.000` and `187 mil` amounts, installment formats, statuses outside the ERP list, blank rows, missing references, and tying every problem to its rows.

## Resulting behavior

- The three original files are read byte-for-byte unchanged, with cell text preserved.
- Every problem type listed in the task is counted per file with one example identified by codes and spreadsheet row, and a treatment of `correct`, `discard`, or `pending`.
- Each file reconciles: customers 139 = 0 + 139 (112 without problems if seller nicknames are mapped); orders 15,359 = 0 + 15,359 (13,703 if mapped); receivables 8,313 = 8,120 + 193.
- The ERP cross-check finds all 120 customer codes and 60 product codes. All 296 receivables issued in October 2026 are in both sources.
- The report contains no CNPJ, company name, or contact name; report assembly refuses an example with a CNPJ.

## Impact

- No impact on the API, the OpenAPI contract, the database, migrations, or the Node.js build: no file under `src/` changed.
- Client data stays out of Git: `ml/data/raw/` is ignored, and `git status` lists only its `.gitkeep`.
- The ERP key is read from the environment and is not written to any file. A check found it in none of the exported files.
- The Python tests run locally only; CI runs Node.js gates. A Python CI job is proposed as a follow-up.
- Risk: the report reflects the files and the ERP export of 2026-11-24. The ERP changes daily, so the cross-check should be rerun before the load.

## Validations executed

| Command                                                   | Result                                                                                                                                                                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ml/.venv/Scripts/python -m pytest -q` (from `ml/`)       | `58 passed in 0.28s`                                                                                                                                                                                                       |
| `pnpm typecheck`                                          | exit code 0                                                                                                                                                                                                                |
| `pnpm lint`                                               | exit code 0                                                                                                                                                                                                                |
| `pnpm test`                                               | `Test Files 9 passed (9)`, `Tests 39 passed (39)`                                                                                                                                                                          |
| `pnpm test:architecture`                                  | `Test Files 1 passed (1)`, `Tests 3 passed (3)`                                                                                                                                                                            |
| `pnpm spec:validate` (`openspec validate --all --strict`) | `✓ change/f11-legacy-profile`, `Totals: 2 passed, 0 failed (2 items)`                                                                                                                                                      |
| `pnpm skills:check`                                       | `✓ 7 skills citi-* espelhadas`, `✓ 6 skills openspec-* nos dois targets`                                                                                                                                                   |
| `pnpm openapi:check`                                      | Fails locally on Windows with `openapi.json is stale`. Pre-existing and unrelated: no file under `src/` or `openapi.json` changed (`git diff origin/main -- src openapi.json` is empty); the checkout converts LF to CRLF. |
| `pnpm exec prettier --check` on the changed files         | All changed files pass; `eslint.config.mjs` passes with `--end-of-line auto` (same CRLF checkout issue).                                                                                                                   |
| Privacy scan of the report and the notebook               | 0 CNPJ-like matches; 0 notebook outputs.                                                                                                                                                                                   |

`pnpm test:integration` and `pnpm test:container` were not run: no database, migration, or container behavior changed.

## Related artifacts

- Proposal: `openspec/changes/f11-legacy-profile/proposal.md`
- Specification: `openspec/changes/f11-legacy-profile/specs/legacy-history/spec.md`
- Design: `openspec/changes/f11-legacy-profile/design.md`
- Tasks: `openspec/changes/f11-legacy-profile/tasks.md`
- Report: `docs/data/legacy-spreadsheets-profile.md`
- ADR: Not applicable. This change measures data and writes a report. It adds no API, database, or other system boundary. Its Python dependencies stay inside `ml/`, where ADR 0001 already places Python with its own dependency file. Keeping client data out of Git applies existing repository rules. The cross-cutting choice of language for the sprint 2 load is only recommended here; it needs an ADR when the team decides it.

## Usage

Follow `ml/README.md` § "Legacy spreadsheets profile (F11)": copy the original files to `ml/data/raw/`, export the ERP with `ERP_API_KEY` set, and run the notebook. Clear its outputs before committing.

## Implementation notes

- The workbooks have a title block, so the header is on row 3 (customers) and row 4 (orders). The notebook passes these rows to the reader and to the report.
- Thresholds are documented in the report: a quantity is suspicious above 10 times the product median, only for products with at least 5 rows.
- Blank rows, total rows, and rows without a code are excluded before duplicate and quantity checks. This keeps a separator row from being counted as a duplicate.
- The orders `Total` column holds formulas without stored values; the report records it, and the load must recompute totals.
