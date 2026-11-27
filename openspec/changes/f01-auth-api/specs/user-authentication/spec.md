## Purpose

Lets portal users sign in with email and password, stay signed in through an expiring session, sign out, and reach only the routes their role allows (F01, US-001, RN-08), and provides the initial users that make sign-in possible.

## ADDED Requirements

### Requirement: Passwords are stored only as salted hashes

The system SHALL store each password only as a salted one-way hash and SHALL verify a password attempt against that hash in constant time.

#### Scenario: Hash differs from the password

- **WHEN** a password is hashed
- **THEN** the stored value is different from the password
- **AND** hashing the same password twice produces different values

#### Scenario: Verification accepts the right password and rejects a wrong one

- **WHEN** a password attempt is verified against a stored hash
- **THEN** verification succeeds for the original password
- **AND** verification fails for any other password

### Requirement: Users sign in with email and password

The system SHALL accept `POST /auth/login` with a JSON body `{ email, password }`. On valid credentials it MUST respond 200 with `{ token, user: { id, name, email, role } }` and start a new session. The email MUST be compared case-insensitively and without surrounding spaces.

#### Scenario: Valid credentials

- **WHEN** an existing user posts their email and correct password to `POST /auth/login`
- **THEN** the response is 200 with a non-empty `token` and the user's `id`, `name`, `email`, and `role`
- **AND** the response never includes the password hash

#### Scenario: Email with different case and surrounding spaces

- **WHEN** user `user@x.com` signs in with email `" USER@x.com "` and the correct password
- **THEN** the response is 200 with that user

#### Scenario: Invalid login body

- **WHEN** the login body is missing the email or the password, or the email is not a valid address
- **THEN** the response is 400 Problem Details

### Requirement: Failed sign-in does not reveal which emails exist

The system MUST answer an unknown email and a wrong password with the same 401 Problem Details whose `detail` is `"E-mail ou senha incorretos"`.

#### Scenario: Unknown email and wrong password get identical responses

- **WHEN** one login uses an email that does not exist and another uses an existing email with a wrong password
- **THEN** both responses are 401 with `detail` `"E-mail ou senha incorretos"`
- **AND** both bodies are identical apart from the request identifier and the instance path

### Requirement: Sign-in attempts are rate limited per IP

The system SHALL accept at most 10 sign-in attempts per minute from the same IP address and MUST answer further attempts in that minute with 429 Problem Details whose `detail` is `"Muitas tentativas de login. Tente novamente em um minuto."`. The client IP SHALL be the address of the connection, unless the API is configured to trust a number of proxy hops (`TRUST_PROXY`, default 0); then it SHALL be read from `X-Forwarded-For` through that many hops, so users behind the hosting proxy are counted separately. Without trusted hops, `X-Forwarded-For` MUST be ignored, so a client cannot dodge the limit by sending it.

#### Scenario: Eleventh attempt in a minute

- **WHEN** the same IP sends 10 sign-in attempts within one minute and then an 11th
- **THEN** the 11th response is 429 with `detail` `"Muitas tentativas de login. Tente novamente em um minuto."`

#### Scenario: Forwarded address ignored without trusted proxies

- **WHEN** `TRUST_PROXY` is 0 and one connection sends 10 sign-in attempts within one minute, each with a different `X-Forwarded-For`, and then an 11th
- **THEN** the 11th response is 429

#### Scenario: Users behind a trusted proxy are counted separately

- **WHEN** `TRUST_PROXY` is 1, the proxy forwards 10 sign-in attempts from `203.0.113.1` within one minute, and then one from `203.0.113.2`
- **THEN** the attempt from `203.0.113.2` is answered normally, not with 429
- **AND** an 11th attempt from `203.0.113.1` in that minute is answered with 429

### Requirement: Signed-in users can identify themselves

The system SHALL respond to `GET /auth/me` with an `Authorization: Bearer <token>` header of an active session with 200 and the user `{ id, name, email, role }`. Without a token, with a malformed header, or with a token that matches no active session, it MUST respond 401 Problem Details.

#### Scenario: Valid token

- **WHEN** a request to `GET /auth/me` carries the token returned by sign-in
- **THEN** the response is 200 with that user's `id`, `name`, `email`, and `role`

#### Scenario: Missing token

- **WHEN** a request to `GET /auth/me` has no `Authorization` header
- **THEN** the response is 401

#### Scenario: Unknown token

- **WHEN** a request to `GET /auth/me` carries a token that was never issued
- **THEN** the response is 401

### Requirement: Users can sign out

The system SHALL accept `POST /auth/logout` with the token of an active session, respond 204, and end that session so the same token MUST then receive 401.

#### Scenario: Token stops working after sign-out

- **WHEN** a signed-in user calls `POST /auth/logout` with their token
- **THEN** the response is 204
- **AND** a later `GET /auth/me` with the same token responds 401

#### Scenario: Sign-out without a token

- **WHEN** `POST /auth/logout` is called without a token
- **THEN** the response is 401

### Requirement: Sessions expire after 8 hours without use

The system MUST reject a session whose last authenticated request was more than 8 hours ago with 401, and SHALL record the time of every accepted authenticated request as the session's last use.

#### Scenario: Idle for more than 8 hours

- **WHEN** a session was last used 8 hours and 1 minute ago and its token is sent to `GET /auth/me`
- **THEN** the response is 401

#### Scenario: Idle for less than 8 hours

- **WHEN** a session was last used 7 hours and 59 minutes ago and its token is sent to `GET /auth/me`
- **THEN** the response is 200
- **AND** the session's last use becomes the time of this request

### Requirement: Protected routes enforce the user's role

The system SHALL let a route require one or more roles. A signed-in user without a required role MUST receive 403 Problem Details whose `detail` is `"Você não tem acesso a esta página"`. A request without a valid session MUST receive 401 before any role check.

#### Scenario: Seller on a manager-only route

- **WHEN** a signed-in SELLER calls a route that requires the MANAGER role
- **THEN** the response is 403 with `detail` `"Você não tem acesso a esta página"`

#### Scenario: Manager on a manager-only route

- **WHEN** a signed-in MANAGER calls a route that requires the MANAGER role
- **THEN** the request is accepted

#### Scenario: No session on a role-protected route

- **WHEN** a request without a token calls a route that requires the MANAGER role
- **THEN** the response is 401

### Requirement: Session tokens are stored only as hashes

The system MUST NOT store a session token. It SHALL store only the SHA-256 hash of the token.

#### Scenario: Database holds only the token hash

- **WHEN** a user signs in and receives a token
- **THEN** no stored session contains the token itself
- **AND** the stored session contains the SHA-256 hash of the token

### Requirement: Sign-in secrets are never logged

The system MUST NOT write the password, the token, the `Authorization` header, or the login request body to logs.

#### Scenario: Login and authenticated request logs contain no secrets

- **WHEN** a user signs in and then calls `GET /auth/me` with the token
- **THEN** the captured log output contains neither the password nor the token

### Requirement: Initial users can be seeded repeatedly

The system SHALL provide a seed that creates, on provisional `@distrilux.test` emails (PRD 12.2), one MANAGER (Fernanda Cavalcanti), one FINANCE (Sérgio Barros), one ADMIN (Lucas Moura), and one SELLER for each distinct seller of the stored customers, all with the initial password from `SEED_DEFAULT_PASSWORD`. The ERP identifies a customer's seller by name, so each SELLER SHALL be named after that value, SHALL have it as seller code, and SHALL get an email made from it: lowercase, without accents, with words joined by dots (`Patrícia Lins` → `patricia.lins@distrilux.test`). Running the seed again MUST NOT duplicate users or change an existing user's password, and SHALL add the sellers of customers stored since the last run. Without `SEED_DEFAULT_PASSWORD`, the seed MUST fail without creating users. When no customer is stored, the seed MUST fail without creating users, with an error saying that the sellers are missing and that the customer sync (`pnpm sync:erp`) must run first.

#### Scenario: Seed creates one user per role and one seller per customer seller

- **WHEN** the stored customers have the sellers `Patrícia Lins` (two customers) and `Marcos Viana`, and the seed runs on a database without users
- **THEN** one MANAGER, one FINANCE, and one ADMIN exist
- **AND** exactly two SELLER users exist: `Patrícia Lins` with seller code `Patrícia Lins` and email `patricia.lins@distrilux.test`, and `Marcos Viana` with seller code `Marcos Viana` and email `marcos.viana@distrilux.test`
- **AND** each user can sign in with the initial password

#### Scenario: Seller of a newly synced customer

- **WHEN** the seed has run, a customer with the new seller `Rodrigo Albuquerque` is stored, and the seed runs again
- **THEN** a SELLER `Rodrigo Albuquerque` is added
- **AND** the users created before are unchanged

#### Scenario: No synced customers

- **WHEN** the seed runs with `SEED_DEFAULT_PASSWORD` set and no customer stored
- **THEN** it fails with an error that says the sellers are missing and names `pnpm sync:erp`
- **AND** no user is created

#### Scenario: Seed runs twice

- **WHEN** the seed runs a second time after a user's password was changed
- **THEN** the number of users is unchanged
- **AND** that user's password is still the changed one

#### Scenario: Missing initial password

- **WHEN** the seed runs without `SEED_DEFAULT_PASSWORD`
- **THEN** it fails with an error that names the missing variable
- **AND** no user is created
