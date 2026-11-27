## Why

The portal has four roles (seller, manager, finance, admin) and each may only see and do what its role allows (F01, US-001, RN-08). Today the API has no sign-in, no route protection, and no users, so no later feature can enforce permissions and nobody on the team or in the client's acceptance testing can sign in.

## What Changes

- Sign-in with email and password (`POST /auth/login`) that returns an opaque session token and the user. An unknown email and a wrong password get the same 401. At most 10 attempts per minute per IP; above that, 429.
- Sign-out (`POST /auth/logout`) that revokes the session, and "who am I" (`GET /auth/me`).
- Sessions that expire after 8 hours without any authenticated request. Every authenticated request extends the session.
- Shared guards for every future route: one requires a signed-in user (401), one requires a role (403, `"Você não tem acesso a esta página"`).
- Passwords stored only as salted scrypt hashes. Tokens stored only as SHA-256 hashes. Neither the password, the token, the `Authorization` header, nor the login body is logged (RN-14 spirit: secrets never leave the API).
- A repeatable seed of initial users: one MANAGER (Fernanda Cavalcanti), one FINANCE (Sérgio Barros), one ADMIN (Lucas Moura), and three invented mock SELLER users, all on provisional `@distrilux.test` emails (PRD 12.2). The initial password comes from `SEED_DEFAULT_PASSWORD`; without it the seed fails.
- **Temporary decision (manager, 2026-11-26):** the task asks for one seller per distinct `Customer.sellerCode`, but the customer sync does not exist yet. The seed therefore creates mock sellers with invented names and `MOCK-` seller codes. This must be replaced by sellers derived from synced customers once the sync exists.

### Out of scope

- User management by the admin (screen or route), password recovery, and password change.
- Portfolio filtering in listings (F04).
- Seller users derived from `Customer.sellerCode` (waits for the customer sync).
- Login screens and token storage in the web and mobile repositories.

## Capabilities

### New Capabilities

- `user-authentication`: signing in and out, identifying the signed-in user, session expiry, role-based access to protected routes, and the initial users that make sign-in possible.

### Modified Capabilities

None.

## Impact

- **Business:** unblocks every role-restricted feature (customer search, orders, dashboard, manager app). Each role can sign in for acceptance testing.
- **API:** three new routes under `/auth`, documented in the regenerated `openapi.json`. Existing routes (`/health/*`, `/openapi.json`, `/docs`) stay public and unchanged.
- **Database:** new `Session` table with a relation to `User`, through an additive migration (`auth_sessions`). No existing table or data changes.
- **Security:** salted scrypt password hashes compared in constant time; tokens of 32 random bytes stored only as SHA-256; per-IP login rate limit; identical responses for unknown email and wrong password; logs never contain secrets.
- **Observability:** request logs keep their current fields; the logger's existing redaction stays, and a test proves login secrets do not appear in logs.
- **Configuration:** new `SEED_DEFAULT_PASSWORD` variable, used only by the seed and left empty in `.env.example`; new `pnpm db:seed` script.
- **Dependencies:** none added (`node:crypto` and the existing `express-rate-limit`).
- **Documentation:** ADR 0005 records the session format (opaque Bearer token) and the temporary mock sellers; `docs/changes/f01-auth-api.md` summarizes the change.
- **Other repositories:** the web and the mobile app send `Authorization: Bearer <token>`; where they store it is recorded in the ADR as guidance.
