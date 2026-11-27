---
title: ADR-0005
status: accepted
date: 2026-11-26
owners: [thiagoac07]
tags: [auth, security, session, f01, us-001, rn-08]
supersedes: null
superseded_by: null
---

# 0005: Opaque Bearer session tokens stored as SHA-256 hashes

## Context

F01 (US-001) adds sign-in for the four portal roles (RN-08). Every later route depends on how a signed-in user is recognized, and the same login serves two clients: the web portal and the manager's mobile app. The task requires:

- real sign-out;
- sessions that end after 8 hours without any request, renewed on every use;
- no secret that could be replayed from a copy of the database.

The choice is hard to reverse: the web and mobile repositories build their HTTP clients around it, and every protected route relies on it.

## Decision

**Session format.**

- Sign-in returns an opaque token made of 32 random bytes, base64url-encoded.
- Clients send it as `Authorization: Bearer <token>` on every request.
- The API stores only the SHA-256 hash of the token in the `Session` table, with `lastSeenAt` and `revokedAt`.
- Rules future changes must preserve:
  - a session is valid only when it is not revoked and `lastSeenAt` is at most 8 hours ago;
  - every accepted authenticated request updates `lastSeenAt`;
  - sign-out sets `revokedAt`;
  - the token itself is never stored, logged, or returned after sign-in.
- Passwords are stored as salted scrypt hashes from `node:crypto` and compared with `timingSafeEqual`.
- Routes are protected by `requireAuth` and `requireRole` in `src/shared/http`, which receive the token check by injection.
- Confirmed with the manager on 2026-11-26, who chose this option over a stateless JWT and an httpOnly cookie.

**Where clients keep the token** (guidance for the web and mobile repositories):

- Web: keep it in memory, with `sessionStorage` as the reload fallback. Do not use `localStorage`. Send it through the shared auth-headers helper.
- Mobile: keep it in the platform's secure storage (for example, Expo SecureStore), never in plain async storage.
- On any 401, both clients discard the token and return to sign-in.

**Client IP for the sign-in limit** (manager, PR review 2026-11-27).

- The sign-in limit (10 attempts per minute per IP) reads the client IP through Express `trust proxy`, set from `TRUST_PROXY` as a number of hops (default 0).
- Each deployment sets it to the number of reverse proxies in front of the API. Behind the hosting proxy without it, every request would share the proxy IP, so the whole company would share 10 attempts per minute and anyone could block every sign-in.
- Never `true` or a value above the real number of proxies: a client could then choose its own IP through `X-Forwarded-For` and dodge the limit.

## Consequences

### Positive

- Sign-out really ends a session, and the 8-hour idle rule is a simple comparison.
- One mechanism for the web and the app; no cookie handling or CSRF protection needed.
- A leaked database copy cannot be used to impersonate users, because it holds only token and password hashes.
- No new dependency.

### Negative

- Every authenticated request reads and writes the database, which is acceptable at DistriLux's scale of a few dozen users.
- The login rate limit uses an in-memory store per process. Running several API instances would need a shared store.
- Expired and revoked sessions accumulate until a cleanup job exists.
- A token kept in web storage can be read by an injected script, so the web must keep strict output escaping and its content security policy.
- Each environment must know how many proxies sit in front of the API and set `TRUST_PROXY` accordingly.

## Alternatives considered

### Stateless JWT

It is signed and needs no database lookup, but it cannot be revoked on sign-out. Renewing it on every use would mean issuing a new token per request. Rejected.

### httpOnly cookie session

It is good for the web, because scripts cannot read the cookie. The mobile app would need cookie handling, and the web would need CSRF protection. Rejected to keep one mechanism for both clients.

## References

- OpenSpec change: `openspec/changes/f01-auth-api/` (proposal, `user-authentication` spec, design D1, D2, D4, and D6)
- Change summary: `docs/changes/f01-auth-api.md`
- PRD: US-001, RN-08, RN-14; section 12.2 (provisional emails)
- ADR 0002 (base data model with `User` and `Role`)
