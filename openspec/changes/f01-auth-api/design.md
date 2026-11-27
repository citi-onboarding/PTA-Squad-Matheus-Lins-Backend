## Context

See `proposal.md` for motivation and `specs/user-authentication/spec.md` for the behavior. Current state:

- `prisma/schema.prisma` already has `User` (`email` unique, `passwordHash`, `role`, optional `sellerCode`) and the `Role` enum (ADR 0002). There is no session storage.
- `src/modules/` does not exist yet; this is the first business module. `pnpm gen:module auth` scaffolds `auth.schemas.ts`, `auth.service.ts`, and `auth.test.ts`.
- `src/app/create-app.ts` applies a global rate limit only outside `NODE_ENV=test`, maps errors through `HttpProblem` and `problemHandler` (RFC 9457), and logs only request id, method, URL, and status code. The pino logger already redacts `authorization`, `cookie`, `password`, and `token` paths.
- `prisma/seed.ts` is a stub. There is no `db:seed` script. The customer sync does not exist, so `Customer` is empty in a fresh database.

## Goals / Non-Goals

**Goals:**

- One session mechanism that the web and the mobile app use the same way.
- Guards in `src/shared/http` so every future module can protect routes without importing the auth module.
- Unit tests that run without a database, and integration tests for what only a real database proves (token hash storage, seed behavior).

**Non-Goals:**

- Refresh tokens, absolute session lifetime, or "sign out everywhere".
- Cleaning up old sessions (expired and revoked rows stay; a cleanup job can come later).
- Account lockout after failed attempts (the per-IP rate limit is the only brute-force control in this change).

## Decisions

### D1. Opaque Bearer token stored as a SHA-256 hash (ADR 0005)

Sign-in creates 32 random bytes (`crypto.randomBytes`), returns them base64url-encoded as `token`, and stores only `sha256(token)` in `Session.tokenHash`. Clients send `Authorization: Bearer <token>`.

- **Why:** sign-out really ends the session (`revokedAt`), the 8-hour idle rule is a simple `lastSeenAt` comparison, and the same header works for the web and the mobile app. A copy of the database cannot be replayed, because only hashes are stored. SHA-256 without salt is enough here because the token has 256 bits of entropy.
- **Rejected: stateless JWT.** It cannot be revoked on sign-out, and renewing it on every use would mean issuing a new token per request.
- **Rejected: httpOnly cookie.** It fits the web, but the mobile app would need cookie handling, and it would require CSRF protection.
- Confirmed by the manager on 2026-11-26.

### D2. Password hashing with scrypt from `node:crypto`

The format is `scrypt$<salt base64>$<key base64>`, with a 16-byte random salt, a 64-byte key, and Node's default cost (N=16384, r=8, p=1), using async `scrypt`. Verification parses the stored value, derives the key with the same salt, and compares with `timingSafeEqual`. A malformed stored value fails verification instead of throwing.

- **Why:** the task asks for no new dependency, and scrypt is memory-hard and built into Node.
- **Rejected: bcrypt or argon2 packages.** They add a native dependency.
- For an unknown email, sign-in still runs one verification against a fixed dummy hash, so the timing does not reveal whether the email exists.

### D3. Module layout and dependency injection

The module lives in `src/modules/auth/`:

- `auth.schemas.ts`: Zod schemas for the login body and responses, registered in the OpenAPI registry.
- `password.ts`: hashes and verifies passwords.
- `session-token.ts`: generates tokens and hashes them.
- `auth.repository.ts`: the `AuthRepository` interface (find a user by normalized email, create a session, find a session with its user by token hash, touch `lastSeenAt`, revoke) and its Prisma implementation.
- `auth.service.ts`: `login`, `logout`, and `authenticate`. It receives the repository and a clock (`now: () => Date`) by injection.
- `auth.routes.ts`: `createAuthRouter`, which only maps HTTP to the service.
- `seed-initial-users.ts`: the seed logic, used by `prisma/seed.ts` and by the integration tests.

This is the first module that registers OpenAPI paths. `scripts/generate-openapi.ts` and `scripts/check-openapi.ts` imported only the registry, so module routes never reached `openapi.json`. Both scripts now import `src/app/create-app.ts` for its side effect, which loads every module's schemas.

Email lookup normalizes the input with trim and lowercase and matches case-insensitively in the database. This makes `" USER@x.com "` find `user@x.com` even if a stored email has capitals.

### D4. Guards in `src/shared/http` receive the authenticator by injection

`requireAuth(authenticate)` reads `Authorization: Bearer <token>`, calls the injected `authenticate(token)` (which resolves to `{ id, role, sellerCode }` or `null`), sets `req.user`, and otherwise raises a 401 `HttpProblem`. `requireRole(...roles)` assumes `requireAuth` ran first and raises a 403 `HttpProblem` with `"Você não tem acesso a esta página"` when `req.user.role` is not allowed.

- **Why:** shared code must not import a module (`architecture.config.mjs`). `create-app.ts` builds the auth service and passes `service.authenticate` to `requireAuth`. Future modules receive the guards the same way.
- `Role` comes from the generated Prisma enums under `src/shared/database/generated`, so shared code does not depend on the module.

### D5. Expiry and last use

`authenticate` rejects a session when `revokedAt` is set or when `now - lastSeenAt > 8 h`. Otherwise it updates `lastSeenAt = now` and returns the user. Because the clock is injected, tests can set `lastSeenAt` at exactly 8 h 1 min and 7 h 59 min.

### D6. Login rate limit

A dedicated `express-rate-limit` instance (`windowMs: 60_000`, `limit: 10`, keyed by IP, in-memory store) sits only on `POST /auth/login`. Unlike the global limiter, it is active in every environment, including tests, because the 429 is part of the contract. Its handler forwards a 429 `HttpProblem`, so the response follows RFC 9457. Each `createApp` call gets its own store, which keeps tests independent.

- **Known limit:** the in-memory store is per process. Running several API instances would need a shared store. Today there is one instance.

### D7. `createApp` accepts optional auth overrides for tests

`createApp({ database, environment, authRepository?, now? })` defaults to the Prisma repository and `() => new Date()`. Unit tests pass an in-memory `AuthRepository` and a controllable clock, so the full HTTP pipeline (rate limit, logging, Problem Details) is tested without a database. Integration tests use the real Prisma repository on a Testcontainers Postgres.

### D8. Seed with mock sellers (temporary, manager decision 2026-11-26)

`seedInitialUsers(database, initialPassword)` upserts by email:

- MANAGER Fernanda Cavalcanti, `fernanda.cavalcanti@distrilux.test`;
- FINANCE Sérgio Barros, `sergio.barros@distrilux.test`;
- ADMIN Lucas Moura, `lucas.moura@distrilux.test`;
- mock SELLER users with invented names: Carla Nogueira (`MOCK-01`), Rafael Duarte (`MOCK-02`), and Juliana Prado (`MOCK-03`), on `nome.sobrenome@distrilux.test`.

The upsert's `update` is empty, so an existing user's password, name, and role are never changed. `prisma/seed.ts` reads `SEED_DEFAULT_PASSWORD` from the environment and fails with a message naming the variable before connecting when it is missing or empty. The variable is not added to the API's `envSchema`, because the API does not use it.

- **Why mock sellers:** the task derives sellers from `Customer.sellerCode`, but the customer sync does not exist, so a fresh database would have no sellers to sign in with. The `MOCK-` prefix makes them easy to find and remove.
- **Follow-up:** once the customer sync exists, replace the mock list with one SELLER per distinct `Customer.sellerCode`, and remove or deactivate the mock sellers. This is recorded in ADR 0005 and in the change doc.

### D9. Migration

`pnpm db:migrate --name auth_sessions` adds the `Session` table (`id`, `userId` FK → `User` with cascade on delete, `tokenHash` unique, `createdAt`, `lastSeenAt`, `revokedAt` nullable) and an index on `userId`. It is additive only: no existing column or row changes, and rollback is dropping the table.

## Risks / Trade-offs

- [Every authenticated request writes `lastSeenAt`] → acceptable at DistriLux's scale (a few dozen users). It could be throttled later without changing the contract.
- [In-memory rate-limit store resets on restart and is per instance] → acceptable with one instance. Revisit when scaling out.
- [Expired and revoked sessions accumulate] → small volume. A cleanup job is a later, non-breaking change.
- [Mock sellers could reach production data] → `@distrilux.test` emails and `MOCK-` codes mark them. The follow-up in D8 removes them once the sync exists.
- [Token in web storage can be read by injected scripts] → the ADR records the storage guidance for the web (memory plus `sessionStorage`, no `localStorage`) and the mobile app (secure storage). Helmet's defaults and output escaping reduce XSS risk.

## Migration Plan

1. Apply the `auth_sessions` migration (`prisma migrate deploy` in deployed environments).
2. Set `SEED_DEFAULT_PASSWORD` and run `pnpm db:seed` once per environment. It is safe to repeat.
3. Rollback: revert the code and drop the `Session` table. `User` rows created by the seed can stay.
