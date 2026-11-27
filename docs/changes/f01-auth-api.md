---
change_id: f01-auth-api
date: 2026-11-26
status: in-progress
owners: [thiagoac07]
tags: [f01, us-001, rn-08, rn-14, auth]
related_adrs: [ADR-0004]
openspec_change: openspec/changes/f01-auth-api/
---

# Backend authentication: login, session, roles, and initial users

## Objective

Let the four portal roles sign in, stay signed in through an expiring session, sign out, and reach only what their role allows (F01, US-001, RN-08). Provide the guards every later route uses and the initial users for the team and acceptance testing.

## Change made

- **Database:** new `Session` model (`userId` → `User`, unique `tokenHash`, `createdAt`, `lastSeenAt`, nullable `revokedAt`) through the additive migration `20261126233720_auth_sessions`.
- **Module `src/modules/auth/`** (the first business module):
  - `password.ts`: salted scrypt hashes from `node:crypto`, compared with `timingSafeEqual`.
  - `session-token.ts`: 32 random bytes and their SHA-256 hash.
  - `auth.repository.ts`: the `AuthRepository` interface and its Prisma implementation.
  - `auth.service.ts`: login, logout, authenticate, and profile, with the clock injected.
  - `auth.schemas.ts`: Zod schemas and OpenAPI registration.
  - `auth.routes.ts`: the three routes and the login rate limit.
  - `seed-initial-users.ts`: the seed logic.
- **Shared guards:** `src/shared/http/require-auth.ts` (401) and `require-role.ts` (403), wired in `src/app/create-app.ts`. `req.user` (`id`, `role`, `sellerCode`) is typed in `src/types/express.d.ts`.
- **`createApp`** accepts optional `authRepository`, `now`, and `logDestination`, so unit tests run the whole HTTP pipeline without a database.
- **Seed:** `prisma/seed.ts` and the `pnpm db:seed` script; `SEED_DEFAULT_PASSWORD=` (empty) in `.env.example`.
- **OpenAPI:**
  - `scripts/generate-openapi.ts` and `scripts/check-openapi.ts` now import `src/app/create-app.ts`, so module routes reach the contract. Before, they loaded only the empty registry.
  - `openapi.json` was regenerated with the three `/auth` routes and the `bearerAuth` scheme.

## Resulting behavior

- `POST /auth/login`:
  - valid credentials → 200 `{ token, user: { id, name, email, role } }`;
  - the email matches case-insensitively and ignoring surrounding spaces;
  - an invalid body → 400 Problem Details;
  - an unknown email and a wrong password → the same 401, `"E-mail ou senha incorretos"`;
  - the 11th attempt per minute from one IP → 429.
- `GET /auth/me` with a valid token → 200 with the user. Without a token or with an unknown one → 401.
- `POST /auth/logout` → 204. The same token then gets 401.
- Sessions:
  - a session idle for more than 8 hours → 401;
  - every accepted request renews it.
- Roles: a route behind `requireRole("MANAGER")` answers 403 `"Você não tem acesso a esta página"` to a seller, and 401 without a session.
- Storage and logs:
  - the database holds only the SHA-256 hash of each token and a salted scrypt hash of each password;
  - logs contain neither the password, the token, nor the `Authorization` header.
- `pnpm db:seed`:
  - creates Fernanda Cavalcanti (MANAGER), Sérgio Barros (FINANCE), Lucas Moura (ADMIN), and the mock sellers Carla Nogueira (`MOCK-01`), Rafael Duarte (`MOCK-02`), and Juliana Prado (`MOCK-03`), on `@distrilux.test`;
  - running it again changes nothing;
  - without `SEED_DEFAULT_PASSWORD`, it fails before writing.

## Impact

- **API:** three new routes, all documented. Existing routes stay public and unchanged.
- **Database:** additive migration only. Rollback is dropping `Session`.
- **Clients:** the web and the mobile app send `Authorization: Bearer <token>`. ADR 0004 records where each keeps the token.
- **Later features:** protect routes with `requireAuth` plus `requireRole`. Portfolio filtering stays with F04.
- **Configuration:** each environment sets its own `SEED_DEFAULT_PASSWORD` before seeding. The seed never overwrites an existing password, so changing the variable later affects only users that do not exist yet.
- **Temporary decision:** the mock sellers replace the sellers derived from `Customer.sellerCode` until the customer sync exists (manager, 2026-11-26). They must be replaced then.
- **Risks:** the login rate-limit store is per process; expired sessions accumulate until a cleanup job exists.

## Validations executed

| Command                                                                                  | Result                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm exec openspec validate f01-auth-api --strict`                                      | `Change 'f01-auth-api' is valid`                                                                                                                                                                                         |
| Red: `pnpm test`, integration suite                                                      | 26 unit and 5 integration tests failed on assertions before production code; the 2 passing were negative cases satisfied by the stubs                                                                                    |
| `pnpm verify` (typecheck, lint, tests, architecture, `openspec validate --all --strict`) | exit code 0; `Tests 105 passed (105)`; `Totals: 5 passed, 0 failed (5 items)`                                                                                                                                            |
| `pnpm test:coverage`                                                                     | `Tests 105 passed (105)`; all files 97.48% statements, 96.25% branches                                                                                                                                                   |
| `pnpm test:integration`                                                                  | `Test Files 3 passed (3)`, `Tests 35 passed (35)`                                                                                                                                                                        |
| `pnpm test:container`                                                                    | `Production container smoke test passed.`                                                                                                                                                                                |
| `pnpm build`                                                                             | exit code 0                                                                                                                                                                                                              |
| `pnpm openapi:check`                                                                     | exit code 0; paths `/auth/login`, `/auth/logout`, `/auth/me`                                                                                                                                                             |
| `pnpm format:check`                                                                      | All F01 files pass `prettier --check`. On this Windows checkout the full command reports 57 pre-existing files that are CRLF only in the working tree (`git ls-files --eol`: `i/lf w/crlf`); none belong to this change. |
| `pnpm db:seed` twice on the local Docker Postgres                                        | 6 users, no duplicates, every `passwordHash` starts with `scrypt$`                                                                                                                                                       |
| Manual sign-in against the rebuilt `docker compose` API                                  | 200 for MANAGER, FINANCE, ADMIN, and SELLER, with `/auth/me` matching; wrong password → 401 `E-mail ou senha incorretos`; container logs contain no password, `Bearer`, or `authorization`                               |

Note: `src/shared/erp/erp-client.integration.test.ts` (F02) runs only where a real ERP key is present, so it is skipped in CI. Locally it failed intermittently because its `reportedTotal` helper calls the ERP without retrying 429 or 503. That is unrelated to this change, which leaves that test untouched; it was reported to the team for the F02 owner.

## Related artifacts

- Proposal: `openspec/changes/f01-auth-api/proposal.md`
- Specification: `openspec/changes/f01-auth-api/specs/user-authentication/spec.md`
- Design: `openspec/changes/f01-auth-api/design.md`
- Tasks: `openspec/changes/f01-auth-api/tasks.md`
- ADR: [ADR 0004](../adr/0004-session-authentication.md): opaque Bearer session tokens, client token storage, and temporary mock sellers

## Usage

1. Set `SEED_DEFAULT_PASSWORD` in `.env`, apply migrations (`pnpm db:migrate:deploy`), and run `pnpm db:seed`.
2. Sign in with `POST /auth/login` `{ "email": "fernanda.cavalcanti@distrilux.test", "password": "<SEED_DEFAULT_PASSWORD>" }`.
3. Send the returned token as `Authorization: Bearer <token>`.
4. Protect a new route in `create-app.ts` with the app's `requireAuth` instance followed by `requireRole("MANAGER", ...)`.

## Implementation notes

- `pnpm gen:module` fails when `src/modules/` does not exist, because it does not create the parent folder. The folder was created by hand; the script is unchanged.
- The Docker build runs `pnpm typecheck` with only `src/` and `prisma/` copied. A test under `src/` must not import files from `tests/`, or the image build fails.
- `requireRole` also answers 401 when used without `requireAuth`; that defensive branch is the only uncovered code (`require-role.ts` lines 11–12).
