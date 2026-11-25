# Legacy spreadsheets profile

First read of the three legacy spreadsheets that hold the DistriLux history before October 2026 (F11, US-011). For each problem found, this report gives the count, one real example identified only by codes and spreadsheet row, and the proposed treatment for the sprint 2 history load, following RN-09 (the ERP wins) and RN-16 (every correction and discard is recorded with its reason).

- OpenSpec change: `openspec/changes/f11-legacy-profile/`
- Reproduce: `ml/notebooks/01-legacy-profile.ipynb` (setup in `ml/README.md`)
- ERP export used for the cross-check: 2026-11-24 22:07 (120 customers, 60 products, 456 receivables)
- Privacy: no CNPJ, company name, or contact name is copied here. Seller names are DistriLux employees listed in the PRD.

## Summary

| File                                 | Rows read | Rows without problems | Rows with problems | Without problems if seller nicknames are mapped |
| ------------------------------------ | --------: | --------------------: | -----------------: | ----------------------------------------------: |
| `Clientes - Comercial.xlsx`          |       139 |                     0 |                139 |                                             112 |
| `Pedidos 2025-2026 - Comercial.xlsx` |    15,359 |                     0 |             15,359 |                                          13,703 |
| `titulos.csv`                        |     8,313 |                 8,120 |                193 |                                  not applicable |

Main findings:

- **No spreadsheet uses the ERP seller names.** Every customer and order row has a nickname or a variant (`Paty`, `Ju Freitas`, `Patricia Lins` without the accent), so no row of those two files is free of problems. The sellers can be mapped safely to the five ERP sellers (see [Seller mapping](#seller-mapping-proposal)).
- **Every customer and product code found in the spreadsheets exists in the ERP**, and all 296 receivables issued in October 2026 are also in the ERP.
- **Most flagged rows can be corrected safely.** Every customer written by name matches exactly one ERP customer, 359 of 363 orders without a product code have a description that matches exactly one ERP product, and every invalid quantity is a whole number written as `2,0` or `19 un`.
- **The orders `Total` column is empty in all 15,359 rows.** These are formulas without a stored value, so totals must be recomputed as quantity × unit price.
- **8 cancelled orders have receivables.** This needs a decision before the load (see [Open questions](#open-questions)).

## Method

- The original files were copied byte for byte to `ml/data/raw/` (ignored by Git) and were never opened in a spreadsheet editor or edited. Every cell was read as text, so formats were measured as typed.
- Both workbooks start with a title block. The column names are on **row 3** of the customers sheet and on **row 4** of the orders sheet. Example row numbers below are the rows a person sees in the spreadsheet.
- Blank rows and total rows are excluded before duplicate checks. Rows without a code are excluded from key-duplicate and quantity checks, because they are already a missing reference.
- Thresholds:
  - A quantity is **suspicious** above 10 times the median quantity of the same product, only for products with at least 5 valid rows. The median is used instead of the mean because the outliers themselves would pull the mean up and hide each other. For example, one line of 3,500 units among lines of about 10 raises the mean more than tenfold.
  - A **total row** has the word `total` in a cell, or has an amount but no reference.
- A row with several problems is counted once in the reconciliation, so the problem counts add up to more than the rows with problems.
- Column types are inferred from the text of every non-empty cell: `integer`, `decimal`, `date`, or `text`. A column that should be numeric but shows `text` (for example `Qtd`) contains values that are not numbers.
- A cell written in a recognized but non-standard format is **not** counted as a row problem, because it converts to one value without ambiguity (see [Format rules](#format-rules)). Only cells that cannot be read (`unrecognized`) are problems, and none were found.

## Format rules

Every format found converts to one value, so the treatment for all of them is `correct`. The original text is kept in the load record (RN-16).

| Data         | Formats found (per file below)                                                                     | Proposed rule                                                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dates        | ISO with or without time, `dd/mm/yyyy`, `dd/mm/yy`, `dd-mm-yyyy`, `dd.mm.yyyy`, spreadsheet serial | Convert to an ISO date. Read two-digit years as 20yy. Read serial numbers as days since 1899-12-30. Day comes before month in every slashed date.                |
| Money        | `R$ 1.234,56`, `1.234,56`, `1234,56`, `1234.56`, `235000`, `20.000`, `187 mil`                     | Convert to integer cents, the ERP unit (RN-13): `187 mil` = R$ 187,000.00 = `18700000`; `20.000` = R$ 20,000.00.                                                 |
| Statuses     | letter-case and trailing-space variants of the same word                                           | Trim, lowercase, and remove accents, then map to the ERP status: `pago` → `PAGO`, `em aberto` → `EM_ABERTO`. Statuses outside the ERP list are `unknown_status`. |
| Installments | `1/3`, `01/03`, `1 de 3`                                                                           | Convert to `n/m`. Use the same value in the receivable key.                                                                                                      |
| Quantities   | `2,0`, `19 un`                                                                                     | Listed as `invalid_quantity` (pending). Read as the whole number only when the decimals are zero and the unit matches the product unit.                          |

## Treatments

| Treatment | Meaning for the sprint 2 load                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| `discard` | The row is not loaded; the discard and its reason are recorded (RN-16).                                     |
| `correct` | The row is loaded with the corrected value; the original and corrected values are recorded (RN-16).         |
| `pending` | The row is not loaded until a person decides; it goes to the pending list with its reason (US-011, US-012). |

The treatment of each problem comes from a single rule table in `ml/legacy_profile/report.py`, covered by tests.

## Customers: `Clientes - Comercial.xlsx`

139 rows, 11 columns, header on row 3. 121 distinct codes, including the `TOTAL` line, against 120 customers in the ERP.

### Columns

| Type    | Columns                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------ |
| text    | `Cód.`, `Razão Social`, `CNPJ`, `Cidade/UF`, `Segmento`, `Vendedor`, `Situação`, `Contato`, `Telefone` |
| decimal | `Limite`                                                                                               |
| date    | `Últ. atualização`                                                                                     |

`Cidade/UF` mixes `Recife - PE`, `Recife/PE`, upper case, and cities without a state. The ERP keeps city and state in separate fields, and the load takes them from the ERP, so this column is not used.

### Formats

| Column             | Formats found                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `Limite`           | `R$ 509.000,00` (34), `187 mil` (34), integer `235000` (33), `20.000` thousands without cents (25), empty (13) |
| `Últ. atualização` | ISO date with time (129), empty (10)                                                                           |
| `Cód.`             | standard `C0000` (122), empty (16), text (1, the `TOTAL` line)                                                 |
| `Situação`         | `ativo` written 3 ways (`Ativo`, `ativo`, `ATIVO`); `bloqueado` 2 ways; `Inativo`; `Prospect`; `ok`            |
| `Vendedor`         | 12 different spellings for 5 ERP sellers                                                                       |

### Problems

| Problem             | Count | Example          | Treatment | Proposed rule                                                                                                   |
| ------------------- | ----: | ---------------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| `unmatched_seller`  |   129 | row 4: `C0098`   | correct   | Replace the nickname with the seller the ERP assigns to the customer (RN-09).                                   |
| `unknown_status`    |    11 | row 11           | pending   | `ok` and `Prospect` are not ERP statuses; take the ERP status when the customer exists there, otherwise review. |
| `blank_row`         |     9 | row 14           | discard   | Empty separator row.                                                                                            |
| `missing_reference` |     7 | row 11           | pending   | Link by company name only when exactly one ERP customer matches. Evidence: 3 of 7 match, 4 have no exact match. |
| `key_duplicate`     |     2 | row 71: `C0112`  | pending   | The codes `C0068` and `C0112` appear twice with different values; the ERP record wins (RN-09).                  |
| `total_row`         |     1 | row 142: `TOTAL` | discard   | Spreadsheet total, not a customer.                                                                              |

No exact duplicates, off-pattern codes, unrecognized limits, or unrecognized dates were found. This sheet is used only to cross-check the ERP: the valid customer register is the ERP (PRD 7.7).

## Orders: `Pedidos 2025-2026 - Comercial.xlsx`

15,359 rows (one per order item), 11 columns, header on row 4. Orders from 2025-01-02 to 2026-09-30.

### Columns

| Type    | Columns                                                                       |
| ------- | ----------------------------------------------------------------------------- |
| integer | `Nº Pedido`                                                                   |
| decimal | `Preço Unit.`                                                                 |
| date    | `Data`                                                                        |
| text    | `Cliente`, `Vendedor`, `Produto`, `Descrição`, `Qtd`, `Un`, `Total`, `Status` |

`Qtd` is `text` only because of the 308 invalid quantities; every other value is a whole number. `Total` is `text` because it is empty.

### Formats

| Column        | Formats found                                                                       |
| ------------- | ----------------------------------------------------------------------------------- |
| `Data`        | ISO date with time (14,877), ISO date (165), `07/01/2025` (159), `08.01.2025` (158) |
| `Preço Unit.` | dot decimal `60.87` (15,200), integer (159)                                         |
| `Cliente`     | standard `C0000` (14,930), company name instead of code (429)                       |
| `Produto`     | standard `P00000` (14,996), empty (363)                                             |
| `Status`      | `Faturado` and `Cancelado`, each written 3 ways (letter case, trailing space)       |
| `Total`       | empty in every row (formulas without a stored value)                                |
| `Vendedor`    | 11 different spellings for 5 ERP sellers                                            |

### Problems

| Problem               |  Count | Example                         | Treatment | Proposed rule                                                                                                                                                       |
| --------------------- | -----: | ------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unmatched_seller`    | 15,359 | row 5: order 40480, `P00005`    | correct   | Replace the nickname with the seller the ERP assigns to the customer (RN-09).                                                                                       |
| `cancelled_order`     |    580 | row 49: order 40494, `P00017`   | correct   | Keep marked as cancelled and exclude from sales figures (US-011).                                                                                                   |
| `name_reference`      |    429 | row 8: order 40481, `P00050`    | pending   | Link by company name when exactly one ERP customer matches. Evidence: all 429 rows (111 distinct names) match exactly one ERP customer.                             |
| `missing_reference`   |    363 | row 188: order 40537            | pending   | Link by product description when exactly one ERP product matches. Evidence: 359 match, 4 have no exact match and stay pending.                                      |
| `invalid_quantity`    |    308 | row 27: order 40487, `P00007`   | pending   | All 308 are whole numbers written as `2,0` (152) or followed by a unit, `19 un` (156); they can be read as the whole number when the unit matches the product unit. |
| `suspicious_quantity` |     25 | row 732: order 40711, `P00012`  | pending   | Above 10 times the product median (for example 3,500 units); confirm with the customer's invoices before loading.                                                   |
| `key_duplicate`       |     22 | row 202: order 40541, `P00017`  | pending   | Same order and product on two lines with different values; one line per product is allowed (RN-06), so a person decides whether to merge.                           |
| `exact_duplicate`     |      5 | row 2408: order 41241, `P00052` | discard   | Identical copy of an earlier line.                                                                                                                                  |

No blank rows, total rows, off-pattern codes, codes missing from the ERP, unrecognized dates, or unrecognized prices were found.

## Receivables: `titulos.csv`

8,313 rows, 9 columns, semicolon-separated, header on row 1. Issued from 2025-01-02 to 2026-10-30.

### Columns

| Type    | Columns                                             |
| ------- | --------------------------------------------------- |
| integer | `id_titulo`, `num_pedido`                           |
| decimal | `valor`                                             |
| date    | `data_emissao`, `data_vencimento`, `data_pagamento` |
| text    | `id_cliente`, `parcela`, `status`                   |

### Formats

| Column            | Formats found                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `data_emissao`    | `02/01/2025` (7,195), ISO (467), `04/01/25` (345), `04-01-2025` (164), spreadsheet serial `45661` (142)        |
| `data_vencimento` | same distribution as `data_emissao`                                                                            |
| `data_pagamento`  | `02/01/2025` (6,722), ISO (433), `04/01/25` (326), `04-01-2025` (156), serial (128), empty (548, not paid yet) |
| `valor`           | comma decimal `2358,78` or `9.346,12` (7,326), currency symbol `R$ 325,50` (496), dot decimal `9346.14` (491)  |
| `parcela`         | `1/3` (7,919), zero-padded `02/03` (210), words `1 de 3` (184)                                                 |
| `id_cliente`      | standard `C0000` (8,170), off-pattern (107), empty (36)                                                        |
| `status`          | `pago`, `vencido`, and `em aberto`, each written 4 ways; `Estornado` (6)                                       |

### Problems

| Problem               | Count | Example                 | Treatment | Proposed rule                                                                                                                                                                          |
| --------------------- | ----: | ----------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `off_pattern_code`    |   107 | row 59: `894007`, 1/3   | correct   | Rewrite as `C` plus 4 digits. Evidence: the zero-padded code exists in the ERP for all 107. The 40 codes with only 3 digits (`C004`) should be confirmed against the order's customer. |
| `exact_duplicate`     |    38 | row 1243: `895183`, 2/3 | discard   | Identical copy of an earlier row.                                                                                                                                                      |
| `missing_reference`   |    36 | row 416: `894362`, 1/3  | pending   | Take the customer of the order (`num_pedido`). Evidence: 31 of 36 orders have a single customer in the orders sheet; 5 stay pending.                                                   |
| `key_duplicate`       |    15 | row 2366: `896298`, 1/3 | pending   | Same receivable number and installment (after reading `01/03` as `1/3`) with different values; a person decides.                                                                       |
| `reversed_receivable` |     6 | row 8309: `895133`, 1/3 | correct   | Keep marked as reversed and exclude from invoicing figures (RN-17). These are exactly the 6 rows with a negative amount.                                                               |

No blank rows, total rows, codes missing from the ERP, unrecognized dates or amounts, or statuses outside the ERP list (besides `Estornado`) were found.

## ERP cross-check

| Check                                                | Result                                 |
| ---------------------------------------------------- | -------------------------------------- |
| Distinct customer codes (all files) found in the ERP | 120 of 120                             |
| Distinct product codes (orders) found in the ERP     | 60 of 60                               |
| Receivables issued in October 2026 in both sources   | 296 in both, 0 only in the spreadsheet |

October 2026 is the only month present in both sources. Since all 296 receivables match by number, the load should take October 2026 from the ERP and stop the spreadsheet at September 2026 (RN-17), which avoids counting them twice.

## Seller mapping proposal

Each nickname maps to one ERP seller; no nickname is ambiguous among the five sellers.

| ERP seller          | Spellings found in the spreadsheets |
| ------------------- | ----------------------------------- |
| Patrícia Lins       | `Patricia Lins`, `Patrícia`, `Paty` |
| Juliana Freitas     | `Juliana`, `Ju Freitas`             |
| Carla Menezes       | `Carla`, `Carla M.`, `Carlinha`     |
| Rodrigo Albuquerque | `Rodrigo`, `Rodrigo A.`             |
| Marcos Viana        | `Marcos`, `Marcos V.`               |

The proposed rule still prefers the seller the ERP assigns to the customer; the table is the fallback for history rows whose customer moved between portfolios.

## Other observations

- The PRD estimated about 9,700 order lines and 6,500 receivables (PRD 7.3); the files have 15,359 and 8,313 rows. The volume estimate should be updated.
- The orders sheet header says "do not change the formulas of the Total column", but the file holds no computed value for that column.
- 548 receivables have no payment date; this is expected for unpaid receivables and is not a problem.

## Open questions

These need a decision by the team or the client before the sprint 2 load:

1. **Cancelled orders with receivables.** 8 of the 174 cancelled orders have receivables. Is the order or the receivable wrong? (Fernanda or Sérgio.)
2. **Customer codes with 3 digits.** Should `C004` be read as `C0004`, or confirmed against the order's customer first? (Team.)
3. **Customer status `ok` and `Prospect`.** Confirm that the ERP status always wins for these 11 rows. (Fernanda.)
4. **Suspicious quantities.** Should the 25 suspicious lines be loaded as typed, or held until confirmed? (Fernanda.)

## Recommendation for the sprint 2 load (not a decision)

**Recommended: a TypeScript `history-load` module in the backend**, with this profile as its reference.

Reasons:

- AGENTS.md and ADR 0001 already place the history load in the backend. The administrator runs the load and reads its report in the portal (PRD 4.2, US-012), which fits an API module better than an offline script.
- The load writes to tables owned by the Prisma schema and migrations. Writing them from TypeScript keeps one owner for the schema, and the existing Vitest suite and CI cover the load. The Python tests in `ml/` do not run in CI today.
- The rules are already specified as testable scenarios in the `legacy-history` spec, and the counts in this report give the load its acceptance numbers (rows read = loaded + discarded + pending).

Costs and alternative:

- Reading `.xlsx` in Node.js needs a new dependency, which must be approved.
- The alternative is to load from Python, reusing `ml/legacy_profile/`. It is faster to start, but it writes to the portal database outside the schema owner and has no CI.
- In both cases, the decision is cross-cutting, so it should be recorded in an ADR when the team decides.
