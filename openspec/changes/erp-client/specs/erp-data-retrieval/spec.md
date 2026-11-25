## Purpose

Give the backend a single, validated, and failure-tolerant way to read
customers, products, and receivables from the DistriLux ERP, the system of
record for F02 synchronization (US-002, RN-09, RN-15).

## ADDED Requirements

### Requirement: Complete ERP listings

The system SHALL read customers, products, and receivables from the ERP as
complete listings, requesting every page from the first to the last reported
page with the maximum page size of 50. Each listing SHALL return `items` (valid
records) and `rejected` (invalid records), and together they SHALL account for
every record the ERP reports for that query.

#### Scenario: Customers are listed across every page

- **WHEN** customers are listed with a valid ERP key
- **THEN** every page is read and the number of `items` plus `rejected` equals the `total` reported by the ERP

#### Scenario: Products are listed across every page

- **WHEN** products are listed with a valid ERP key
- **THEN** every page is read and the number of `items` plus `rejected` equals the `total` reported by the ERP

#### Scenario: Receivables are listed across every page

- **WHEN** receivables are listed with a valid ERP key
- **THEN** every page is read and the number of `items` plus `rejected` equals the `total` reported by the ERP

#### Scenario: Pages are requested in full size

- **WHEN** any listing is requested
- **THEN** every ERP request asks for page size 50, starting at page 1 and ending at the last page reported by the ERP

### Requirement: Incremental ERP listings

The system SHALL accept an optional point in time and, when it is given, SHALL
ask the ERP only for records changed after it by sending it as
`atualizadoDesde`.

#### Scenario: Only changed records are requested

- **WHEN** a listing is requested with `updatedSince` set to `2026-11-23T12:00:00-03:00`
- **THEN** every ERP request for that listing carries `atualizadoDesde=2026-11-23T12:00:00-03:00`

#### Scenario: Nothing changed after a future instant

- **WHEN** customers, products, or receivables are listed with `updatedSince` in the future
- **THEN** `items` and `rejected` are both empty

### Requirement: Validated ERP data

The system MUST validate every ERP page and every record against the ERP
contract before returning it. Records keep the ERP field names. Amounts are
integer cents (RN-13), and `pagamento` is the only nullable receivable field.
A record that violates the contract MUST NOT interrupt the listing and MUST NOT
be silently dropped: it is returned in `rejected` with its `codigo` (customers
and products) or `numero` (receivables) when readable, the page it came from,
and the validation issues, without the record's content. Deciding what to do
with rejected records is outside this capability.

#### Scenario: Valid customers are returned with ERP field names

- **WHEN** the ERP returns customers that satisfy the contract
- **THEN** each customer in `items` has `codigo`, `razaoSocial`, `cnpj`, `cidade`, `uf`, `segmento`, `limiteCreditoCentavos`, `vendedor`, `dataCadastro`, `status`, and `atualizadoEm`, and `rejected` is empty

#### Scenario: Open receivable without payment date

- **WHEN** the ERP returns a receivable whose `pagamento` is `null`
- **THEN** the receivable is returned in `items` with `pagamento` equal to `null`

#### Scenario: One invalid record in the middle of a page

- **WHEN** the ERP returns a page of three customers whose second customer has `status` `SUSPENSO`
- **THEN** the first and third customers are returned in `items` in their original order, and `rejected` holds one entry with that customer's `codigo`, the page number, and an issue pointing to `status`

#### Scenario: Invalid record without a readable key

- **WHEN** the ERP returns a product record without a string `codigo`
- **THEN** the record is returned in `rejected` with no key, its page number, and its validation issues

#### Scenario: Malformed page

- **WHEN** the ERP answers with status `200` but the body is not valid JSON or lacks `dados` or `totalPaginas`
- **THEN** the page request is treated as a server error and retried, and if it stays malformed the listing fails with an error

### Requirement: Authenticated ERP access

The system SHALL send the configured ERP key in the `X-Api-Key` header of every
ERP request and MUST NOT write the key, request or response headers, or
response bodies to logs or error messages (RN-14).

#### Scenario: Every request is authenticated

- **WHEN** any listing is requested
- **THEN** every ERP request carries the configured key in the `X-Api-Key` header

#### Scenario: Invalid key

- **WHEN** customers, products, or receivables are listed with an invalid ERP key
- **THEN** the listing fails immediately with an error carrying status `401`, without retrying

#### Scenario: Key stays secret in failures

- **WHEN** a listing fails for any reason
- **THEN** the resulting error does not contain the ERP key

### Requirement: Transient ERP failure handling

The system SHALL retry ERP calls that fail transiently and SHALL NOT retry
client errors. Each call SHALL time out after 60 seconds. A call is made at most
4 times: the initial call plus up to 3 retries.

- 429 or 503: wait the number of seconds in `Retry-After`, or 5 seconds when it
  is absent, and retry.
- Other 5xx, a timeout, a network failure without a response, or a malformed
  page: retry waiting 1, 2, and 4 seconds. Server errors are classified by HTTP
  status even when the error body is not a Problem (for example an HTML page).
- 401, 422, and any other 4xx: fail immediately.
- When every attempt fails, the error MUST carry the ERP `status` and, when the
  body is a Problem, its `detail` and `erros`.

#### Scenario: Recovers after transient server errors

- **WHEN** an ERP call fails twice with status `500` and then succeeds
- **THEN** the successful result is returned after 3 calls

#### Scenario: Server error persists

- **WHEN** an ERP call always fails with status `500`
- **THEN** it is called 4 times, waiting 1, 2, and 4 seconds between calls, and then fails with an error carrying status `500`

#### Scenario: Network failure is retried

- **WHEN** an ERP call fails without any response (connection refused or reset) and then succeeds
- **THEN** the call is retried after waiting 1 second and the successful result is returned

#### Scenario: Server error with a non-Problem body

- **WHEN** an ERP call fails with status `502` and an HTML body, and keeps failing
- **THEN** it is retried like any server error and finally fails with an error carrying status `502` and no `detail`

#### Scenario: Short rate limit is honored

- **WHEN** an ERP call fails with status `429` and `Retry-After: 1`
- **THEN** the call is retried after waiting 1 second

#### Scenario: Unavailable without Retry-After

- **WHEN** an ERP call fails with status `503` without a `Retry-After` header
- **THEN** the call is retried after waiting 5 seconds

#### Scenario: Invalid parameters are not retried

- **WHEN** an ERP call fails with status `422`
- **THEN** the call fails immediately with an error carrying status `422`, the Problem `detail`, and its `erros`, and it is not repeated

#### Scenario: Call times out

- **WHEN** the ERP does not answer a call within 60 seconds
- **THEN** the call is abandoned and retried with the server-error backoff

### Requirement: Long rate-limit signaling

The system SHALL NOT wait when the ERP asks to retry after more than 300
seconds (typical of the daily limit); it SHALL fail immediately with a
rate-limit error exposing the requested wait in seconds, so the caller can
decide when to try again (RN-15).

#### Scenario: Daily limit reached

- **WHEN** an ERP call fails with status `429` and `Retry-After: 3600`
- **THEN** the call fails immediately, without waiting, with a rate-limit error whose `retryAfterSeconds` is `3600`

#### Scenario: Wait at the threshold is honored

- **WHEN** an ERP call fails with status `429` and `Retry-After: 300`
- **THEN** the call is retried after waiting 300 seconds

### Requirement: ERP connection configuration

The system MUST read the ERP base URL and key from validated environment
variables `ERP_BASE_URL` (a URL) and `ERP_API_KEY` (a non-empty string), and
MUST reject an invalid configuration at startup.

#### Scenario: Valid configuration

- **WHEN** the environment defines `ERP_BASE_URL=https://pta-erp-api.onrender.com` and a non-empty `ERP_API_KEY`
- **THEN** the configuration is accepted and exposes both values

#### Scenario: Invalid base URL

- **WHEN** `ERP_BASE_URL` is not a valid URL
- **THEN** configuration parsing fails

#### Scenario: Missing or empty key

- **WHEN** `ERP_API_KEY` is missing or empty
- **THEN** configuration parsing fails

### Requirement: Offline-safe verification

Checks against the real ERP SHALL run only when an ERP key is available and
MUST be skipped otherwise, so automated pipelines without the key stay green
when the ERP is offline.

#### Scenario: No key in the environment

- **WHEN** the real-ERP checks run without `ERP_API_KEY` defined
- **THEN** they are reported as skipped and the run succeeds
