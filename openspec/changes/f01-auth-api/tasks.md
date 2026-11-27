## 1. SDD

- [x] 1.1 Write proposal, user-authentication spec, design, and tasks for F01 (US-001, RN-08, RN-14)
- [x] 1.2 Run `pnpm exec openspec validate f01-auth-api --strict`

## 2. Red

- [x] 2.1 Scaffold the module with `pnpm gen:module auth`, add the `Session` model to `prisma/schema.prisma`, and create the additive migration with `pnpm db:migrate --name auth_sessions` (Docker required)
- [x] 2.2 Developer writes the unit tests, one per spec scenario: password hashing and verification; login (valid, case and spaces, invalid body, identical 401s, 429 on the 11th attempt); `/auth/me` (valid, missing, unknown token); logout; idle expiry at 8 h 1 min and 7 h 59 min with `lastSeenAt` updated; `requireRole("MANAGER")` with a seller (403), a manager (accepted), and no token (401); no password or token in logs
- [x] 2.3 Developer writes the integration tests on Testcontainers Postgres: only the token hash is stored; the seed creates one user per role and three mock sellers; the seed run twice neither duplicates users nor changes a changed password; the seed without `SEED_DEFAULT_PASSWORD` fails and creates no user
- [x] 2.4 Add stubs with the final signatures (`password.ts`, `session-token.ts`, `auth.repository.ts`, `auth.service.ts`, `auth.routes.ts`, `seed-initial-users.ts`, `require-auth.ts`, `require-role.ts`, `req.user` typing) so tests fail on their assertions, not on imports
- [x] 2.5 Run `pnpm test` and `pnpm test:integration` and confirm the new tests fail

## 3. Green

- [x] 3.1 Implement password hashing (scrypt, random salt, `timingSafeEqual`) and session tokens (32 random bytes, SHA-256 hash)
- [x] 3.2 Implement the Prisma and in-memory-friendly `AuthRepository`, and the auth service with injected clock (login, logout, authenticate with 8-hour idle expiry and `lastSeenAt` update)
- [x] 3.3 Implement `requireAuth` and `requireRole` in `src/shared/http`, `req.user` in `src/types/express.d.ts`, and the auth router with the login rate limit; wire them in `src/app/create-app.ts`
- [x] 3.4 Implement `seedInitialUsers`, `prisma/seed.ts` reading `SEED_DEFAULT_PASSWORD`, the `db:seed` script, and `SEED_DEFAULT_PASSWORD=` in `.env.example`
- [x] 3.5 Run `pnpm test` and `pnpm test:integration` and confirm every test passes

## 4. Refactor

- [x] 4.1 Remove duplication and clarify names without changing behavior
- [x] 4.2 Run `pnpm test` and `pnpm test:integration` and confirm the suites stay green

## 5. Consolidation

- [x] 5.1 Regenerate `openapi.json` with `pnpm openapi:generate` and confirm it lists the three `/auth` routes
- [x] 5.2 Run `pnpm db:seed` on the local stack and sign in with each role through `POST /auth/login` (Docker required)
- [x] 5.3 Run `pnpm format:check`, `pnpm verify` (typecheck, lint, tests, `openspec validate --strict`), `pnpm test:coverage`, `pnpm test:integration`, `pnpm test:container`, and `pnpm build`
- [x] 5.4 Write `docs/adr/0005-session-authentication.md` from the ADR template (session format, where the web and the app store the token) and add it to the ADR index
- [x] 5.5 Write `docs/changes/f01-auth-api.md` from the change template and add it to the index

## 6. PR review fixes (2026-11-27)

- [x] 6.1 Merge `main` (F02 `erp-sync-persist`), resolve the indexes, regenerate the Prisma client, and renumber the session ADR to 0005
- [x] 6.2 Update the spec and design: sellers from the synced customers (name as seller code, email from the name), fail without customers, `TRUST_PROXY`, and the 429 detail in Portuguese
- [x] 6.3 Red: seed tests with synced customers, a new seller on a later run, and no customers; `TRUST_PROXY` parsing; forwarded addresses ignored with 0 and counted separately with 1; the 429 detail
- [x] 6.4 Green: implement the seller seed, `TRUST_PROXY` in `env.ts`, `.env.example`, and `createApp`, and the 429 detail
- [x] 6.5 Run every gate, seed after `pnpm sync:erp`, sign in with each role, and update ADR 0005 and `docs/changes/f01-auth-api.md`
