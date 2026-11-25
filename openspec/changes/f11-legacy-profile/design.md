## Context

See `proposal.md` for the motivation. `ml/` exists only as a README (ADR 0001 places Python code there, outside `src/`). The backend has no ERP sync yet, so the cross-check cannot read the portal database and uses a local export of the ERP lists instead. The ERP requires the team key in the `X-Api-Key` header on every endpoint, lists are paginated with `pagina` and `tamanho` (max 50), and 429 and 503 responses carry `Retry-After`. The original spreadsheets contain CNPJs and contact names.

## Goals / Non-Goals

**Goals:**

- A tested Python package that measures each problem the specification lists, so the numbers in the report are reproducible.
- A notebook that only calls that package on the real files and shows the tables used to write the report.

**Non-Goals:**

- Any cleaning or writing of data; functions only measure and classify.
- A generic data-quality framework; detectors cover exactly the problems in the spec.

## Decisions

### Python in `ml/` for the profile

pandas and openpyxl read `.xlsx` and `.csv` directly, and the same environment will hold the churn features (F26), which ADR 0001 already places in `ml/`.

- Alternative: a TypeScript script in `scripts/`. Rejected because reading `.xlsx` needs a new Node.js dependency that has not been approved, and the analysis is exploratory.

### Logic in a package, notebook as a thin caller

`ml/legacy_profile/` holds the readers, detectors, ERP matching, and report assembly. Each function receives a pandas Series or DataFrame plus the column names to use, because the real column names are only known after the first read. The notebook maps the real columns and calls the functions.

- Alternative: logic inside notebook cells. Rejected because it cannot be unit tested and hides the rules from review.

### Read everything as text

Files are read with every column as text and with empty cells kept as empty text. pandas would otherwise silently turn `007` into `7`, parse ambiguous dates, and replace blanks with NaN, which would hide the very format problems this change measures.

The first read showed that both workbooks start with a title block: the column names are on row 3 of the customers sheet and on row 4 of the orders sheet. The reader therefore takes the header row as a parameter, and the report receives the same value so every example cites the real spreadsheet row.

### Format classification by ordered patterns

- **Dates** are tested in order against: ISO (with or without time), day/month/year, day/month/short-year, day-month-year, day.month.year, and a spreadsheet serial number (an integer between 30000 and 60000).
- **Money values** are tested against: currency symbol, comma decimal, dot decimal, thousands without cents (`20.000`), amount in words (`187 mil`), and integer.
- **Installments** are tested against: slash (`1/3`), zero-padded slash (`01/03`), and words (`1 de 3`). For key comparison only, they are normalized to `n/m`.
- Anything else is unrecognized.

Statuses are grouped by their trimmed, lowercased, accent-free form, with underscores read as spaces, so that the ERP's `EM_ABERTO` matches `Em aberto`. Statuses outside the ERP list for that record type are flagged as unknown.

### Thresholds

- A quantity is suspicious when it is more than 10 times the median quantity of the same product. The median is computed only from valid quantities, and only for products with at least 5 rows.
- A total row is a row with `total` in any cell (case-insensitive) or with an amount but no order, customer, or product reference.

The report states both thresholds so the team can review them.

### Proposed rules come from a fixed table

Each problem type maps to one treatment and reason in a single table in the package, following RN-09 and RN-16. Examples:

| Problem              | Treatment                                  |
| -------------------- | ------------------------------------------ |
| Exact duplicates     | discard                                    |
| Off-pattern code     | correct when a safe ERP match exists       |
| Name-based reference | pending unless one ERP record matches      |
| Total rows           | discard                                    |
| Cancelled orders     | keep marked and exclude from sales figures |

The report renders this table, and a test checks that every detected problem has an entry.

### ERP export with the standard library

`ml/scripts/export_erp.py` uses `urllib` with the key from the `ERP_API_KEY` environment variable, requests every page with `tamanho=50`, sleeps for `Retry-After` on 429 and 503 (with a retry cap), and writes `ml/data/raw/erp/{clientes,produtos,titulos}.json`. HTTP access goes through an injectable opener so tests run without the network.

- Alternative: `requests`. Rejected as an unnecessary dependency for three GET loops.

### Privacy guard in report assembly

Before rendering, every example is checked for CNPJ-like digit sequences (14 digits, masked or not). A match raises an error naming the offending example. Examples are built from code columns and row numbers only.

### Recommendation for the sprint 2 load

The report closes with a recommendation, not a decision, on running the load as a TypeScript `history-load` module or in Python. The recommendation is based on the measured problems.

## Risks / Trade-offs

- [Real column names or file encodings differ from expectations] → Functions take column names as parameters and the CSV reader tries UTF-8 and then Latin-1 with delimiter sniffing. The notebook documents the mapping.
- [Python tests do not run in CI, which only runs Node.js] → Tests run locally with documented commands. A CI job is proposed in the pull request as a follow-up.
- [Notebook outputs could leak CNPJs or names into Git] → The notebook is committed with outputs cleared, and raw data stays under the ignored `ml/data/raw/`.
- [ERP data changes daily] → The report records the export date next to every cross-check number.

## Migration Plan

Not applicable: offline analysis with no deployed component. Rolling back means deleting the added files.
