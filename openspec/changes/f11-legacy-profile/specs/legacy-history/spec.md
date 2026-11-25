## Purpose

Profile the hand-filled legacy spreadsheets (customers, orders 2025-2026, and receivables) so the team knows every data problem, how often it happens, and how the history load will treat it, following RN-09 and RN-16 (F11, US-011).

## ADDED Requirements

### Requirement: Original files are read without change

The profile SHALL read the three original files as delivered, keep every cell as the text that was typed, and MUST NOT edit, convert, or rewrite the files.

#### Scenario: Files are unchanged after profiling

- **WHEN** the profile reads an original file
- **THEN** the file's content is byte-for-byte identical before and after the read

#### Scenario: Cell text is preserved

- **WHEN** a cell contains `007`, `1.234,56`, or an empty value
- **THEN** the profile sees exactly `007`, `1.234,56`, or an empty text, with no number or date conversion

#### Scenario: Header below title rows

- **WHEN** a sheet has a title on row 1, an empty row 2, and the column names on row 3
- **THEN** the profile takes the column names from row 3 and treats row 4 as the first record

### Requirement: Structure inventory

The profile SHALL report, per file, the number of rows, the number of columns, and the inferred type of each column (integer, decimal, date, or text).

#### Scenario: Rows, columns, and types are reported

- **WHEN** a file with 3 rows and the columns `numero`, `valor`, and `emissao` is profiled
- **THEN** the profile reports 3 rows, 3 columns, and a type for each of the 3 columns

### Requirement: Format inventory

The profile SHALL report, per column, each distinct format found for dates, money values, installments, and status values, with its count.

#### Scenario: Mixed date formats are counted

- **WHEN** a date column contains `2025-01-31`, `31/01/2025`, `31/01/25`, `45688`, and `ontem`
- **THEN** the profile reports one occurrence each of ISO date, day/month/year, day/month/short-year, spreadsheet serial number, and unrecognized

#### Scenario: Mixed money formats are counted

- **WHEN** a money column contains `R$ 1.234,56`, `1.234,56`, `1234.56`, `1234`, and `abc`
- **THEN** the profile reports one occurrence each of currency symbol, comma decimal, dot decimal, integer, and unrecognized

#### Scenario: Dotted dates are recognized

- **WHEN** a date column contains `08.01.2025`
- **THEN** the profile reports it as day.month.year and reads it as 8 January 2025

#### Scenario: Thousands without cents and amounts in words are recognized

- **WHEN** a money column contains `20.000` and `187 mil`
- **THEN** the profile reports one occurrence each of thousands without cents and amount in words

#### Scenario: Installment formats are counted

- **WHEN** an installment column contains `1/3`, `01/03`, and `1 de 3`
- **THEN** the profile reports one occurrence each of slash, zero-padded slash, and words, and treats all three as installment 1 of 3

#### Scenario: Status variants are grouped

- **WHEN** a status column contains `Pago`, ` pago`, `PAGO`, and `Em aberto`
- **THEN** the profile reports two normalized statuses, with three written variants for the first one

### Requirement: Duplicate detection

The profile SHALL count exact duplicate rows and rows that repeat a business key: order number and product for orders, and receivable number and installment for receivables. A duplicate count MUST exclude the first occurrence.

#### Scenario: Exact duplicates are counted

- **WHEN** the same row appears three times
- **THEN** the profile reports two exact duplicates

#### Scenario: Key duplicates with different values are counted

- **WHEN** two order rows share order number and product but have different quantities
- **THEN** the profile reports one key duplicate and zero exact duplicates

#### Scenario: Key duplicates with differently written installments are counted

- **WHEN** two receivable rows have the number `900001` and the installments `1/3` and `01/03`
- **THEN** the profile reports one key duplicate

### Requirement: Reference quality

The profile SHALL classify each customer and product reference as a standard ERP code (`C` plus 4 digits, `P` plus 5 digits), an off-pattern code, or a name-based reference, and SHALL report seller values that do not exactly match a seller name known to the ERP.

#### Scenario: Customer references are classified

- **WHEN** a customer column contains `C0001`, `c-001`, and `Construtora Exemplo`
- **THEN** the profile reports one standard code, one off-pattern code, and one name-based reference

#### Scenario: Missing reference is flagged

- **WHEN** a row has data but its customer or product reference cell is empty
- **THEN** that row is flagged as a missing reference

#### Scenario: Seller nicknames are reported

- **WHEN** the ERP knows the seller `Patricia Lins` and a row has the seller `Paty`
- **THEN** the profile reports `Paty` as a seller value that does not match the ERP

### Requirement: Suspicious rows

The profile SHALL flag order quantities that are not whole numbers above zero or are more than ten times the median quantity of the same product, total rows, blank separator rows, cancelled orders, and reversed receivables.

#### Scenario: Outlier quantity is flagged

- **WHEN** a product is usually ordered in quantities around 10 and one row orders 500
- **THEN** that row is flagged as a suspicious quantity

#### Scenario: Invalid quantity is flagged

- **WHEN** a row has the quantity `0`, `-3`, or `2,5`
- **THEN** that row is flagged as an invalid quantity

#### Scenario: Total rows are flagged

- **WHEN** a row has the text `TOTAL` in any cell, or has an amount but no order, customer, or product reference
- **THEN** that row is flagged as a total row

#### Scenario: Blank separator rows are flagged

- **WHEN** a row has every cell empty or with only spaces
- **THEN** that row is flagged as a blank row

#### Scenario: Cancelled orders and reversed receivables are flagged

- **WHEN** an order status reads `cancelado` or a receivable status reads `Estornado`, in any letter case
- **THEN** the order is flagged as cancelled and the receivable as reversed

### Requirement: Statuses outside the ERP list

The profile SHALL flag status values whose normalized form is not one of the statuses the ERP uses for that record type.

#### Scenario: Unknown customer status is flagged

- **WHEN** the ERP customer statuses are `ATIVO`, `BLOQUEADO`, and `INATIVO` and a row has the status `ok` or `Prospect`
- **THEN** that row is flagged as an unknown status, while `Ativo` and ` bloqueado` are not

#### Scenario: ERP statuses written with underscores match spaced spellings

- **WHEN** the ERP receivable status is `EM_ABERTO` and a row has the status `Em aberto`
- **THEN** that row is not flagged

### Requirement: ERP cross-check

The profile SHALL report how many distinct customer codes and product codes from the spreadsheets exist in the ERP, and how many receivables issued in October 2026 exist in both the spreadsheet and the ERP, matched by receivable number. When no ERP export is available, the cross-check MUST be reported as pending, never as zero matches.

#### Scenario: Codes are matched against the ERP

- **WHEN** the spreadsheet references the customers `C0001`, `C0002`, and `C9999` and the ERP has `C0001` and `C0002`
- **THEN** the profile reports 2 matched and 1 unmatched customer code

#### Scenario: October 2026 receivables overlap

- **WHEN** the spreadsheet has receivables `900001` and `900002` issued in October 2026 and the ERP has only `900001`
- **THEN** the profile reports 1 receivable found in both sources and 1 found only in the spreadsheet

#### Scenario: ERP export is missing

- **WHEN** the profile runs without an ERP export
- **THEN** the cross-check is reported as pending

### Requirement: Problem report with proposed rule

The profile SHALL list, per file, every problem found with its count, one real example, and the proposed treatment: correct, discard with reason, or send to pending.

#### Scenario: Each problem has count, example, and rule

- **WHEN** a file has exact duplicates
- **THEN** the report lists the problem with its count, an example row reference, and the treatment `discard` with its reason

#### Scenario: Example row numbers match the spreadsheet

- **WHEN** the column names are on row 4 and the problem is in the first record
- **THEN** the example cites row 5

### Requirement: Row reconciliation

The profile SHALL reconcile each file so that rows read equal rows without problems plus rows with at least one problem, counting a row once even when it has several problems. Every problem MUST be tied to the rows where it occurs, including problems found by classifying a column or by comparing it with the ERP.

#### Scenario: Classified cells are tied to their rows

- **WHEN** a date column has `ontem` on its second record and valid dates elsewhere
- **THEN** the unrecognized date problem points to that record only

#### Scenario: Values missing from a reference list are tied to their rows

- **WHEN** the ERP knows `C0001` and the spreadsheet rows reference `C0001`, `C9999`, and an empty cell
- **THEN** only the row with `C9999` is tied to the not-in-ERP problem

#### Scenario: A row with two problems is counted once

- **WHEN** a file has 10 rows, one of them both duplicated and with an invalid quantity, and no other problems
- **THEN** the profile reports 10 rows read, 9 rows without problems, and 1 row with problems

### Requirement: Privacy of the published report

The published report MUST NOT contain CNPJ numbers or contact names; examples SHALL identify rows only by codes and row numbers.

#### Scenario: Example with a CNPJ is rejected

- **WHEN** a report example contains a 14-digit CNPJ, with or without punctuation
- **THEN** the report is not produced and the profile reports which example violated the rule

### Requirement: ERP export for the cross-check

The ERP export SHALL read every page of customers, products, and receivables using the team key from the server environment, wait and retry when the ERP answers with a rate limit or unavailability, and MUST NOT write the key to any output.

#### Scenario: All pages are exported

- **WHEN** the ERP reports 3 pages of customers
- **THEN** the export contains the records of all 3 pages exactly once

#### Scenario: Rate limit is honored

- **WHEN** the ERP answers a page with status 429 and `Retry-After: 2`
- **THEN** the export waits 2 seconds, requests the same page again, and continues without losing or duplicating records

#### Scenario: Missing key stops the export

- **WHEN** the export starts without a team key in the environment
- **THEN** no request is sent and the export stops with a message naming the missing variable

#### Scenario: The key never reaches the output

- **WHEN** the export finishes
- **THEN** no exported file contains the team key
