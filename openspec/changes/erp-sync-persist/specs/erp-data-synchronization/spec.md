## Purpose

Keeps the portal's copy of ERP customers, products, and receivables up to date,
so every feature reads ERP data from the portal database instead of calling the
ERP, which is the system of record (US-002, RN-09, RN-15).

## ADDED Requirements

### Requirement: ERP records converted to the portal model

The system SHALL store ERP customers, products, and receivables with the portal's
English field names and status values. Date-only ERP values SHALL be stored as
midnight in Recife (`-03:00`), ERP date-times SHALL keep their own instant, and
amounts SHALL stay integer cents. Every receivable stored from the ERP SHALL be
marked as coming from the ERP.

#### Scenario: Customer fields and status are converted

- **WHEN** the ERP returns customer `C0001` with `razaoSocial` "Eletro Recife",
  `limiteCreditoCentavos` 5000000, `vendedor` "V01", `status` `BLOQUEADO`, and
  `dataCadastro` `2021-12-20`
- **THEN** the stored customer `C0001` has legal name "Eletro Recife", credit
  limit 5000000 cents, seller code "V01", status `BLOCKED`, and registration date
  `2021-12-20T00:00:00-03:00`

#### Scenario: Product fields are converted

- **WHEN** the ERP returns product `P0001` with `precoTabelaCentavos` 1990 and
  `ativo` false
- **THEN** the stored product `P0001` has list price 1990 cents and is inactive

#### Scenario: Receivable status and dates are converted

- **WHEN** the ERP returns receivable 1001 with `status` `EM_ABERTO`, `emissao`
  `2026-10-05`, `vencimento` `2026-11-05`, `pagamento` null, and `atualizadoEm`
  `2026-11-05T09:00:00-03:00`
- **THEN** the stored receivable 1001 has status `OPEN`, issue date
  `2026-10-05T00:00:00-03:00`, due date `2026-11-05T00:00:00-03:00`, no payment
  date, ERP update time `2026-11-05T09:00:00-03:00`, and source `ERP`

#### Scenario: Paid and overdue receivables are converted

- **WHEN** the ERP returns one receivable with `status` `PAGO` and `pagamento`
  `2026-11-10`, and another with `status` `VENCIDO`
- **THEN** they are stored with status `PAID` and payment date
  `2026-11-10T00:00:00-03:00`, and `OVERDUE`, respectively

### Requirement: Duplicate-free storage

The system SHALL store each ERP record under its ERP key — customer code,
product code, or receivable number — so that a record returned again updates the
existing one. The system MUST NOT delete stored records, including records the
ERP does not return in a run. A receivable returned by the ERP SHALL overwrite a
stored receivable with the same number loaded from a spreadsheet.

#### Scenario: New record is added

- **WHEN** the ERP returns customer `C0002`, which is not stored
- **THEN** customer `C0002` is stored

#### Scenario: Changed record is updated in place

- **WHEN** customer `C0001` is stored with credit limit 5000000 cents and the ERP
  returns it with credit limit 8000000 cents
- **THEN** customer `C0001` has credit limit 8000000 cents and there is still one
  customer `C0001`

#### Scenario: Running twice adds no rows

- **WHEN** the synchronization runs twice against the same ERP data
- **THEN** the number of stored customers, products, and receivables after the
  second run equals the number after the first

#### Scenario: Records absent from a run are kept

- **WHEN** product `P0009` is stored and an incremental run does not return it
- **THEN** product `P0009` is still stored, unchanged

#### Scenario: ERP receivable overwrites a spreadsheet receivable

- **WHEN** receivable 2001 is stored from a spreadsheet and the ERP returns
  receivable 2001
- **THEN** receivable 2001 holds the ERP values and its source is `ERP`

### Requirement: Incremental ERP reads

The system SHALL ask the ERP only for records updated since the starting point
recorded by the entity's last successful run minus 5 minutes. When the entity has
no successful run, or that run recorded no starting point, the system SHALL read
every record. A successful run SHALL record its own start time as the next
starting point, except where the missing-customer requirement keeps the previous
one.

#### Scenario: First run reads everything

- **WHEN** customers have never been synchronized successfully
- **THEN** the ERP is asked for every customer, without an update filter

#### Scenario: Next run reads only changes

- **WHEN** the last successful products run recorded `2026-11-26T10:00:00-03:00`
  as its starting point
- **THEN** the next products run asks the ERP for products updated since
  `2026-11-26T09:55:00-03:00`

#### Scenario: Failed run does not move the starting point

- **WHEN** a products run fails after a successful run that recorded T
- **THEN** the next products run asks the ERP for products updated since T minus
  5 minutes

### Requirement: Synchronization run records

The system SHALL record each entity synchronization as a run for `customers`,
`products`, or `receivables`. A run SHALL be `RUNNING` from its start, and SHALL
end as `SUCCESS` or `FAILURE` with its end time, the number of records read from
the ERP (valid plus rejected), and the number rejected. A failed run SHALL carry a
short error that MUST NOT contain the ERP key, the ERP URL, headers, response
bodies, or personal data. A failure SHALL leave the previously stored data of
that entity unchanged.

#### Scenario: Successful run is recorded

- **WHEN** the ERP returns 120 valid customers
- **THEN** a customers run ends as `SUCCESS` with an end time, 120 records read,
  0 rejected, and its start time as the next starting point

#### Scenario: ERP failure is recorded without losing data

- **WHEN** 60 products are stored and the ERP keeps answering 503 during a
  products run
- **THEN** the products run ends as `FAILURE` with a short error, and the 60
  stored products are unchanged

#### Scenario: ERP daily limit is recorded

- **WHEN** the ERP reports its daily limit during a run
- **THEN** that run ends as `FAILURE` with the error `rate limited`

#### Scenario: Error never contains the ERP key

- **WHEN** a run fails for any reason
- **THEN** its error does not contain the value of the ERP key

### Requirement: Internal failures are logged safely

When a run fails for a reason that does not come from the ERP, such as a
database error, the system SHALL log the failure with the entity, the error
type, and the error code when one exists. The log MUST NOT contain the error
message, the stack trace, the ERP key, or any record content.

#### Scenario: Storage failure is logged without its message

- **WHEN** storing customers fails with a database error of code `P2003` whose
  message contains a customer's legal name
- **THEN** one error is logged with entity `customers`, the error type, and code
  `P2003`, and the log contains neither the legal name nor the message

#### Scenario: ERP failures are not logged as internal failures

- **WHEN** a run fails because the ERP keeps answering 503
- **THEN** no internal-failure log is written; the run's error
  `erp error: http 503` already records it

### Requirement: Rejected ERP records

The system MUST NOT store an ERP record that fails validation, so the last valid
stored version of that record stays in place. Each rejected record SHALL be
counted in the run and logged with only its key and validation error. When more
than 10% of the records read for an entity in a run are rejected, the run SHALL
end as `FAILURE` and no record of that entity from the run SHALL be stored.

#### Scenario: One invalid record among valid ones

- **WHEN** customer `C0003` is stored and the ERP returns 20 customers, of which
  `C0003` has an unknown status
- **THEN** the other 19 customers are stored, the stored `C0003` is unchanged,
  the run is `SUCCESS` with 20 records read and 1 rejected, and the log carries
  `C0003` and its validation error but no other field of the record

#### Scenario: Exactly 10% rejected

- **WHEN** the ERP returns 10 products, of which 1 is invalid
- **THEN** the run ends as `SUCCESS` and the 9 valid products are stored

#### Scenario: More than 10% rejected

- **WHEN** the ERP returns 10 products, of which 2 are invalid
- **THEN** the run ends as `FAILURE` with 10 records read and 2 rejected, and none
  of the 10 products is stored or changed

### Requirement: Missing customer of a receivable

Before storing any receivable of a run, the system SHALL look up in the ERP, once
per code, every customer referenced by the run's receivables that is not stored,
and store each customer the ERP returns valid. A receivable whose customer the ERP
does not know SHALL be rejected as `customer not found`; a receivable whose
customer the ERP returns invalid SHALL be rejected as `customer invalid`. A
receivables run with any such rejection SHALL keep the previous starting point, so
those receivables are read again. A lookup failure for any other reason SHALL end
the receivables run as `FAILURE` before any receivable of the run is stored.

#### Scenario: Missing customer is fetched and stored

- **WHEN** receivable 1001 references customer `C0050`, which is not stored, and
  the ERP returns `C0050`
- **THEN** customer `C0050` is stored and receivable 1001 is stored

#### Scenario: Missing customer is looked up once

- **WHEN** receivables 1001, 1002, and 1003 reference customer `C0050`, which is
  not stored
- **THEN** the ERP is asked for customer `C0050` exactly once

#### Scenario: Customer unknown to the ERP

- **WHEN** receivable 1004 references customer `C0099` and the ERP answers that
  `C0099` does not exist
- **THEN** receivable 1004 is rejected as `customer not found`, the other
  receivables are stored, and the next receivables run reads from the previous
  starting point

#### Scenario: Customer returned invalid by the ERP

- **WHEN** receivable 1005 references customer `C0077`, which is not stored, and
  the ERP returns `C0077` with an invalid field
- **THEN** customer `C0077` is not stored, receivable 1005 is rejected as
  `customer invalid`, the other receivables are stored, and the next receivables
  run reads from the previous starting point

#### Scenario: Customer lookup keeps failing

- **WHEN** a missing customer is looked up and the ERP keeps answering 503
- **THEN** the receivables run ends as `FAILURE` and no receivable of the run is
  stored

#### Scenario: Customer lookup hits the daily limit

- **WHEN** a missing customer is looked up and the ERP reports its daily limit
- **THEN** the receivables run ends as `FAILURE` with `rate limited`, no further
  customer is looked up, and no receivable of the run is stored

### Requirement: Single-customer ERP lookup

The system SHALL look up one ERP customer by code with the same authentication,
timeout, and retry policy as the ERP listings, and SHALL validate the returned
customer before use. An ERP "not found" answer SHALL be reported as not found
after a single call. The lookup MUST NOT expose the ERP key in any error.

#### Scenario: Existing customer

- **WHEN** customer `C0001` is looked up and the ERP returns it
- **THEN** the validated customer `C0001` is returned

#### Scenario: Unknown customer

- **WHEN** customer `C9999` is looked up and the ERP answers 404
- **THEN** "not found" is returned and the ERP was called once

#### Scenario: Invalid customer

- **WHEN** customer `C0077` is looked up and the ERP returns it with an unknown
  status
- **THEN** the lookup reports the customer as invalid, with only its validation
  issues

#### Scenario: Code is sent safely

- **WHEN** a customer is looked up with a code containing `/` or spaces
- **THEN** the code is sent as a single encoded path segment

#### Scenario: Transient failure is retried

- **WHEN** the ERP answers 503 once and then returns the customer
- **THEN** the customer is returned

#### Scenario: Invalid key

- **WHEN** a customer is looked up with an invalid ERP key
- **THEN** the lookup fails with status 401 after a single call, and the error
  does not contain the key

### Requirement: Synchronization order

The system SHALL synchronize customers, then products, then receivables. When the
customers run fails, products SHALL still be synchronized, the ERP SHALL NOT be
asked for receivables, and a receivables run SHALL be recorded as `FAILURE` with
the error `skipped: customers sync failed`. A products failure SHALL NOT prevent
the receivables run.

#### Scenario: All entities in order

- **WHEN** a full synchronization runs and the ERP is available
- **THEN** customers, products, and receivables are synchronized in that order,
  each with its own successful run

#### Scenario: Customers failure skips receivables

- **WHEN** the customers run fails during a full synchronization
- **THEN** products are synchronized, receivables are not requested from the ERP,
  and the receivables run is `FAILURE` with `skipped: customers sync failed`

#### Scenario: Products failure does not skip receivables

- **WHEN** the products run fails during a full synchronization
- **THEN** receivables are still synchronized

### Requirement: Manual synchronization command

The system SHALL provide a command that runs one full synchronization against the
configured ERP and database and reports each entity's result without printing the
ERP key, record contents, or personal data.

#### Scenario: Command fills the tables and is repeatable

- **WHEN** the command runs against the real ERP with an empty database, and then
  runs again
- **THEN** customers, products, and receivables are stored after the first run,
  and the second run adds no rows
