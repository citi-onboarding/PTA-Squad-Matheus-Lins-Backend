---
change_id: f01-auth-api
date: 2026-11-26
status: in-progress
owners: [thiagoac07]
tags: [f01, us-001, rn-08, rn-14, auth]
related_adrs: [ADR-0005]
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
- **Configuration:** `TRUST_PROXY` (integer ≥ 0, default 0) in `src/shared/config/env.ts` and `.env.example`, passed to Express `trust proxy` as a hop count.
- **OpenAPI:**
  - `scripts/generate-openapi.ts` and `scripts/check-openapi.ts` now import `src/app/create-app.ts`, so module routes reach the contract. Before, they loaded only the empty registry.
  - `openapi.json` was regenerated with the three `/auth` routes and the `bearerAuth` scheme.

## Resulting behavior

- `POST /auth/login`:
  - valid credentials → 200 `{ token, user: { id, name, email, role } }`;
  - the email matches case-insensitively and ignoring surrounding spaces;
  - an invalid body → 400 Problem Details;
  - an unknown email and a wrong password → the same 401, `"E-mail ou senha incorretos"`;
  - the 11th attempt per minute from one IP → 429, `"Muitas tentativas de login. Tente novamente em um minuto."`;
  - the IP is the connection address, or the address `TRUST_PROXY` hops back in `X-Forwarded-For`, so users behind the hosting proxy are counted separately.
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
  - creates Fernanda Cavalcanti (MANAGER), Sérgio Barros (FINANCE), Lucas Moura (ADMIN), and one SELLER per distinct `Customer.sellerCode` of the synced customers, on `@distrilux.test`;
  - the ERP sends the seller name as `vendedor`, so each SELLER is named after it, keeps it as `sellerCode`, and gets an email from it (`Patrícia Lins` → `patricia.lins@distrilux.test`);
  - running it again changes no existing user and adds the sellers of newly synced customers;
  - without `SEED_DEFAULT_PASSWORD`, or with no customer stored, it fails before writing; the second error says the sellers are missing and to run `pnpm sync:erp` first.

## Impact

- **API:** three new routes, all documented. Existing routes stay public and unchanged.
- **Database:** additive migration only. Rollback is dropping `Session`.
- **Clients:** the web and the mobile app send `Authorization: Bearer <token>`. ADR 0005 records where each keeps the token.
- **Later features:** protect routes with `requireAuth` plus `requireRole`. Portfolio filtering stays with F04.
- **Configuration:** each environment sets `TRUST_PROXY` to the number of reverse proxies in front of the API (0 when none) and its own `SEED_DEFAULT_PASSWORD` before seeding. The seed never overwrites an existing password, so changing the variable later affects only users that do not exist yet.
- **Seed order:** `pnpm sync:erp` must run before `pnpm db:seed`. The first version of this change seeded three mock sellers (`MOCK-01` to `MOCK-03`) while the sync did not exist; the PR review on 2026-11-27 replaced them, now that the sync is merged. The seed never deletes users, so a local database seeded before keeps its mock sellers until they are removed by hand.
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

PR review fixes (merge of `main` with F02, sellers from the synced customers, `TRUST_PROXY`, 429 detail in Portuguese), run on 2026-11-27 on the reviewer's machine (Windows, Docker Desktop 29.4.0):

| Command                                                                       | Result                                                                                                                                                                                   |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Red: `vitest run` on `env.test.ts` and `auth.test.ts`; auth integration suite | `Tests 6 failed \| 22 passed (28)` and `Tests 4 failed \| 3 passed (7)`, all on assertions                                                                                               |
| Green: same commands                                                          | `Tests 28 passed (28)` and `Tests 7 passed (7)`; no test changed after Red                                                                                                               |
| `pnpm format:check`, `pnpm exec prisma format --check`                        | both clean                                                                                                                                                                               |
| `pnpm verify`                                                                 | `Tests 162 passed (162)`; architecture `3 passed`; `openspec validate --all --strict` `6 passed, 0 failed`; `openapi:check` and `skills:check` passed                                    |
| `pnpm test:coverage` and `pnpm build`                                         | `Tests 162 passed (162)`; build passed                                                                                                                                                   |
| `pnpm test:integration`                                                       | 3 migrations applied; auth, ERP sync repository, and base data model suites passed; `45 passed \| 1 failed (46)`, the failure being the F02 real-ERP `listReceivables` test noted below  |
| `pnpm test:container`                                                         | `3 migrations found`, all applied; `Production container smoke test passed.`                                                                                                             |
| `pnpm db:seed` on an empty disposable Postgres                                | fails with `No sellers to create: no customer is stored. Run pnpm sync:erp before pnpm db:seed. No user was created.`; 0 users                                                           |
| `pnpm sync:erp`, then `pnpm db:seed` twice                                    | 120 / 60 / 485 synced; 8 users: MANAGER, FINANCE, ADMIN, and 5 SELLERs (Carla Menezes, Juliana Freitas, Marcos Viana, Patrícia Lins, Rodrigo Albuquerque); still 8 after the second run  |
| Sign-in through the running API                                               | 200 for MANAGER, FINANCE, ADMIN, and two SELLERs, each with `/auth/me` 200; wrong password → 401 `E-mail ou senha incorretos`; the server log contains neither the password nor `Bearer` |

Note: `src/shared/erp/erp-client.integration.test.ts` (F02) runs only where a real ERP key is present, so it is skipped in CI. Locally it failed intermittently because its `reportedTotal` helper calls the ERP without retrying 429 or 503. That is unrelated to this change, which leaves that test untouched; it was reported to the team for the F02 owner.

## Related artifacts

- Proposal: `openspec/changes/f01-auth-api/proposal.md`
- Specification: `openspec/changes/f01-auth-api/specs/user-authentication/spec.md`
- Design: `openspec/changes/f01-auth-api/design.md`
- Tasks: `openspec/changes/f01-auth-api/tasks.md`
- ADR: [ADR 0005](../adr/0005-session-authentication.md): opaque Bearer session tokens and client token storage

## Usage

1. Apply migrations (`pnpm db:migrate:deploy`), run `pnpm sync:erp`, set `SEED_DEFAULT_PASSWORD` in `.env`, and run `pnpm db:seed`.
2. Sign in with `POST /auth/login` `{ "email": "fernanda.cavalcanti@distrilux.test", "password": "<SEED_DEFAULT_PASSWORD>" }`.
3. Send the returned token as `Authorization: Bearer <token>`.
4. Protect a new route in `create-app.ts` with the app's `requireAuth` instance followed by `requireRole("MANAGER", ...)`.

## Implementation notes

- `pnpm gen:module` fails when `src/modules/` does not exist, because it does not create the parent folder. The folder was created by hand; the script is unchanged.
- The Docker build runs `pnpm typecheck` with only `src/` and `prisma/` copied. A test under `src/` must not import files from `tests/`, or the image build fails.
- `requireRole` also answers 401 when used without `requireAuth`; that defensive branch is the only uncovered code (`require-role.ts` lines 11–12).
