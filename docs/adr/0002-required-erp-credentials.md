---
title: ADR-0002
status: accepted
date: 2026-11-24
owners: [FlavioNorberto]
tags: [erp, configuration, security, f02]
supersedes: null
superseded_by: null
---

# 0002: ERP credentials are required at startup, with placeholders in keyless local runtimes

## Context

F02 (US-002) introduces the ERP client in `src/shared/erp/`, configured by two
new environment variables: `ERP_BASE_URL` and `ERP_API_KEY`. The task requires
them to be validated with Zod as `z.url()` and `z.string().min(1)`.

`src/shared/config/env.ts` parses the whole environment when the server starts,
and a parsing failure stops the process. Two runtimes start the API without any
ERP key today:

- `docker-compose.yml`, used by the team to run the stack locally;
- `scripts/test-container.mjs` (`pnpm test:container`), which builds the image
  and checks health endpoints.

The real ERP key belongs to the PM and must never be committed, logged, or
returned (RN-14). CI does not receive it either, so the real-ERP integration
tests are skipped there. Nothing in the running API calls the ERP yet; the
synchronization that will use the client is the next F02 task.

A required variable therefore either breaks those runtimes or forces a decision
on how they obtain a value. This affects every developer and every environment
that starts the API, so it is recorded here.

## Decision

- `ERP_BASE_URL` and `ERP_API_KEY` are **required** by the environment schema.
  A missing or invalid value stops the API at startup.
- Runtimes that start the API without access to the real key provide an
  explicit, non-secret placeholder:
  - `docker-compose.yml` uses `${ERP_API_KEY:-not-configured}` and
    `${ERP_BASE_URL:-https://pta-erp-api.onrender.com}`, so a developer's real
    key from the git-ignored `.env` is used when present and the placeholder
    otherwise;
  - `scripts/test-container.mjs` passes `ERP_API_KEY=not-configured` and the
    public `ERP_BASE_URL`.
- `.env.example` documents both variables with an empty `ERP_API_KEY=`.
- The placeholder is never a real credential. Any ERP call made with it fails
  with `401`, which the client reports without retrying.
- Future runtimes that start the API must define both variables, either with
  the real key from a secret store or with the placeholder when they do not
  call the ERP.

## Consequences

### Positive

- A deployed environment without ERP configuration fails at startup instead of
  failing later, at the first synchronization.
- The task's validation rules are followed as written.
- Local Docker and the container test keep working without distributing the
  real key.

### Negative

- Every runtime that starts the API must define both variables, even when it
  never calls the ERP.
- In a runtime using the placeholder, ERP calls fail with `401`. This is only
  visible once the synchronization exists; the error must make the cause clear.
- `docker-compose.yml` and `scripts/test-container.mjs` must be kept aligned
  with the environment schema.

## Alternatives considered

### Optional `ERP_API_KEY`, required only where the client is created

The API would start without the key and the synchronization would check it
before creating the client. Rejected because it contradicts the task's
`z.string().min(1)` rule and moves a configuration error from startup to the
first synchronization run.

### Real key required in every runtime

Every developer and the container test would need the PM's key. Rejected
because it spreads a secret that should stay with few people (RN-14) and blocks
anyone without the key from running the stack.

## References

- OpenSpec change: `openspec/changes/erp-client/` (design pending decision P2).
- Task: `docs/tasks/erp-client.md`.
- Change summary: `docs/changes/erp-client.md`.
- PRD: US-002, RN-14, RN-15.
- Decided by the challenge manager on 2026-11-24.
