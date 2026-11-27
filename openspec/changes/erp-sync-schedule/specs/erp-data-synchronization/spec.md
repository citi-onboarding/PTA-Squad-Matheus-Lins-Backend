## ADDED Requirements

### Requirement: Automatic synchronization schedule

When automatic synchronization is enabled (`SYNC_ENABLED`, default `true`), the
system SHALL run a full synchronization (customers, then products, then
receivables) when the API starts and then again `SYNC_INTERVAL_MINUTES` after the
previous one ends, while the API runs. When it is disabled, the system MUST NOT
start any synchronization by itself. `SYNC_INTERVAL_MINUTES` SHALL be a whole
number of at least 5 (default 60), `SYNC_RETRY_MINUTES` a whole number of at
least 1 (default 10), and `SYNC_ENABLED` either `true` or `false`; the API MUST
refuse to start with any other value.

#### Scenario: Runs at start and after the interval

- **WHEN** the API starts with automatic synchronization enabled and
  `SYNC_INTERVAL_MINUTES` 60, and every synchronization succeeds
- **THEN** a synchronization runs at start
- **AND** the next one runs 60 minutes after the first ends, and not before

#### Scenario: Disabled

- **WHEN** the API runs with `SYNC_ENABLED` `false`
- **THEN** no synchronization runs, however long the API runs

#### Scenario: Default settings

- **WHEN** none of the three settings is set
- **THEN** the interval is 60 minutes, the retry delay is 10 minutes, and
  automatic synchronization is enabled

#### Scenario: Invalid settings

- **WHEN** `SYNC_INTERVAL_MINUTES` is 4, `SYNC_RETRY_MINUTES` is 0, or
  `SYNC_ENABLED` is `yes`
- **THEN** the API refuses to start

### Requirement: Recovery after a failed synchronization

After a synchronization in which any entity run ends as `FAILURE`, the system
SHALL try again `SYNC_RETRY_MINUTES` after it ends instead of waiting the full
interval; after a synchronization in which every entity run succeeds, it SHALL
return to `SYNC_INTERVAL_MINUTES`. An error that escapes a synchronization, such
as an unavailable database, MUST NOT stop the API or the schedule: it SHALL be
logged with only its type and code, and the next attempt SHALL happen after
`SYNC_RETRY_MINUTES`.

#### Scenario: Retry after a failure

- **WHEN** a scheduled synchronization ends with a products run `FAILURE`, with
  `SYNC_RETRY_MINUTES` 10 and `SYNC_INTERVAL_MINUTES` 60
- **THEN** the next synchronization runs 10 minutes later

#### Scenario: Back to the interval after a success

- **WHEN** the synchronization after a failure succeeds for every entity
- **THEN** the next one runs `SYNC_INTERVAL_MINUTES` later

#### Scenario: Unexpected error does not stop the schedule

- **WHEN** a scheduled synchronization fails with an error that escapes it, whose
  message contains a customer's name
- **THEN** the API keeps running, the error is logged with its type and code but
  not its message, and the next synchronization runs `SYNC_RETRY_MINUTES` later

### Requirement: ERP daily limit does not hold a run

When the ERP reports its daily limit during a scheduled synchronization, the
affected run SHALL end at once as `FAILURE` with the error `rate limited`, no run
SHALL remain `RUNNING` waiting for the limit, and the next synchronization SHALL
happen after the larger of the wait the ERP asked for and `SYNC_RETRY_MINUTES`.

#### Scenario: Daily limit of one hour

- **WHEN** a scheduled synchronization meets the ERP daily limit with a requested
  wait of 3600 seconds, and `SYNC_RETRY_MINUTES` is 10
- **THEN** the affected run ends as `FAILURE` with `rate limited`, no run is
  `RUNNING` afterwards, and the next synchronization runs 3600 seconds later

#### Scenario: Daily limit shorter than the retry delay

- **WHEN** the ERP asks to wait 120 seconds and `SYNC_RETRY_MINUTES` is 10
- **THEN** the next synchronization runs 10 minutes later

### Requirement: One synchronization at a time

Before a synchronization starts, scheduled or manual, the system SHALL look for a
run of any entity that is still `RUNNING`. When one started less than 30 minutes
ago, the synchronization MUST NOT run: the system SHALL log
`sync skipped: run in progress`, and the scheduler SHALL check again
`SYNC_RETRY_MINUTES` later. A `RUNNING` run that started 30 minutes ago or more
is stuck, for example because the API stopped during it: the system SHALL end it
as `FAILURE` with the error `stale run` and an end time, and the synchronization
SHALL then run. The manual synchronization command SHALL report
`skipped: run in progress` and exit with a failure code when it is skipped.

#### Scenario: Run in progress

- **WHEN** a receivables run started 10 minutes ago is `RUNNING` and a
  synchronization is due
- **THEN** no new run starts, `sync skipped: run in progress` is logged, and the
  scheduler checks again `SYNC_RETRY_MINUTES` later

#### Scenario: Stuck run

- **WHEN** a customers run started 31 minutes ago is `RUNNING` and a
  synchronization is due
- **THEN** that run ends as `FAILURE` with `stale run` and an end time
- **AND** the synchronization runs

#### Scenario: Restart during a synchronization

- **WHEN** the API stops while a run is `RUNNING` and starts again
- **THEN** synchronizations are skipped until that run is 30 minutes old, after
  which it is marked `stale run` and the synchronization runs again

#### Scenario: Manual command during a run

- **WHEN** the manual synchronization command runs while a run started 5 minutes
  ago is `RUNNING`
- **THEN** it starts no run, prints `skipped: run in progress`, and exits with a
  failure code

### Requirement: Synchronization status

The system SHALL answer `GET /sync/status` for any signed-in user, whatever their
role, with 200 and an object with `customers`, `products`, and `receivables`.
Each SHALL carry `lastSuccessAt` (end time of the last `SUCCESS` run of that
entity, or `null`), `lastAttemptAt` (start time of the last run of that entity,
whatever its result, or `null`), and `lastResult` (`SUCCESS`, `FAILURE`,
`RUNNING`, or `null`), with times as ISO 8601 date-times. Without a valid session
it MUST answer 401. The response MUST NOT contain the ERP key, the ERP URL,
headers, run errors, or ERP data.

#### Scenario: No session

- **WHEN** `GET /sync/status` is called without a token
- **THEN** the response is 401

#### Scenario: Any role

- **WHEN** a signed-in SELLER, MANAGER, FINANCE, or ADMIN calls
  `GET /sync/status`
- **THEN** the response is 200

#### Scenario: Never synchronized

- **WHEN** no synchronization has ever run and a signed-in user calls
  `GET /sync/status`
- **THEN** every field of the three entities is `null`

#### Scenario: Success followed by a failure

- **WHEN** the products ran successfully, ending at `2026-11-27T12:05:00Z`, and
  the next products run, started at `2026-11-27T13:00:00Z`, failed
- **THEN** products has `lastSuccessAt` `2026-11-27T12:05:00.000Z`,
  `lastAttemptAt` `2026-11-27T13:00:00.000Z`, and `lastResult` `FAILURE`

#### Scenario: Run in progress

- **WHEN** a receivables run is `RUNNING`
- **THEN** receivables has `lastResult` `RUNNING` and `lastAttemptAt` equal to
  that run's start

#### Scenario: No secret in the response

- **WHEN** a signed-in user calls `GET /sync/status` after any synchronization
- **THEN** the response does not contain the value of the ERP key or the ERP URL
