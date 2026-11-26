## Purpose

Define the records DistriLux can retain from the ERP and historical spreadsheets, including the outcomes of synchronization and load runs.

## ADDED Requirements

### Requirement: Persist customers and products by ERP code

The portal SHALL store customers and products with generated integer IDs and unique ERP codes within each record type. Customer records SHALL retain legal name, digit-only CNPJ, city, state, segment, credit limit, seller code, registration date, and status (ACTIVE, BLOCKED, or INACTIVE). Product records SHALL retain description, category, unit, list price, and active status. Customer records SHALL be indexed by seller code to support portfolio lookups. F02 (US-002), RN-08, RN-09.

#### Scenario: Store ERP reference data

- **WHEN** valid customer and product records with unused ERP codes are saved
- **THEN** each has a generated ID and its reference data can be retrieved by ERP code
- **AND** customer records can be selected using their seller code

#### Scenario: Reject a duplicate ERP code

- **WHEN** a second customer uses a stored customer code or a second product uses a stored product code
- **THEN** the write is rejected and the original record is retained

#### Scenario: Inspect the portfolio lookup index

- **WHEN** the deployed database indexes are inspected
- **THEN** the customer seller code has an index

### Requirement: Store receivables with a unique number and a customer

The portal SHALL store a generated integer ID, a unique integer receivable number, an installment identifier, an amount, issue and due dates, a status (PAID, OPEN, or OVERDUE), and a required reference to an existing customer by ERP code. The customer reference SHALL be indexed. F02 (US-002), RN-09, RN-16.

#### Scenario: Store multiple installments of one order

- **WHEN** receivables for the same ERP order have distinct numbers and refer to an existing customer
- **THEN** each installment is stored as a separate record and all are accessible through the customer's receivable records

#### Scenario: Reject a duplicate receivable number

- **WHEN** a new receivable uses an existing number, including when its installment differs
- **THEN** the write is rejected and the existing receivable is retained

#### Scenario: Reject an unknown customer reference

- **WHEN** a receivable is written with a customer code absent from the customer records
- **THEN** the write is rejected

#### Scenario: Inspect the receivable lookup index

- **WHEN** the deployed database indexes are inspected
- **THEN** the receivable customer code has an index

### Requirement: Preserve receivable origin and optional ERP data

The portal SHALL store a receivable source of ERP or SPREADSHEET, defaulting to ERP. ERP order number, payment date, and ERP update timestamp SHALL be nullable so unpaid records and spreadsheet records can be stored. F02 (US-002), RN-09, RN-16.

#### Scenario: Default the source of a receivable

- **WHEN** a valid receivable is saved without a source
- **THEN** its stored source is ERP

#### Scenario: Store an unpaid spreadsheet receivable

- **WHEN** an unpaid spreadsheet receivable is saved without an ERP order number, payment date, or ERP update timestamp
- **THEN** its source is SPREADSHEET and the three omitted values are null

### Requirement: Preserve amounts and write timestamps

The portal SHALL store credit limits, list prices, and receivable amounts as integer cents and all date fields as date-time values. The portal SHALL maintain the latest portal write timestamp for customers, products, and receivables, independently of the ERP update timestamp. F02 (US-002), RN-13, RN-15.

#### Scenario: Round-trip monetary values

- **WHEN** a credit limit, list price, or receivable amount of 1,234.56 BRL is persisted
- **THEN** the stored and returned value is exactly 123456 integer cents

#### Scenario: Distinguish an ERP timestamp from a portal write

- **WHEN** a customer, product, or receivable is created and later updated without changing its ERP update timestamp
- **THEN** its portal write timestamp advances and its ERP update timestamp retains its prior value

### Requirement: Persist data operation runs

The portal SHALL store run records with generated integer IDs for ERP synchronization and historical load, scoped to customers, products, or receivables. On creation the start time SHALL default to the current time, the result to RUNNING, and the read count to zero. The run SHALL allow a nullable finish time and a nullable error message free of personal data and credentials. Valid results SHALL be RUNNING, SUCCESS, and FAILURE. F02 (US-002), RN-14, RN-15, RN-16.

#### Scenario: Record the start of a run

- **WHEN** a run is created with its type and entity and the defaulted fields are omitted
- **THEN** it has a generated ID, a populated start time, result RUNNING, zero items read, and null finish time and error

#### Scenario: Retain a completed run outcome

- **WHEN** a run is saved with a finish time, an item count, and a terminal result
- **THEN** those values can be read back together with any supplied sanitized error message
