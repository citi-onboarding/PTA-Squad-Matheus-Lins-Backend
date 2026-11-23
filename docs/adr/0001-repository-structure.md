---
title: ADR-0001
status: accepted
date: 2026-11-22
owners: [Matheus Lins]
tags: [repositories, architecture]
supersedes: null
superseded_by: null
---

# 0001: Three repositories from the CITi boilerplates, with the churn model inside the backend

## Context

The DistriLux portal has an API, a web portal, a manager mobile app, an AI document-triage agent, a one-time load of legacy spreadsheets, and a churn-risk model trained in Python. The PTA provides one boilerplate per client (`pta-api`, `pta-web`, `pta-mobile`) and requires every repository to keep CI green, reviewed pull requests, and ADRs. The ERP API rejects calls from browsers and phones, so every ERP and AI call must start on the server.

## Decision

- Use exactly three repositories, each created from its CITi boilerplate: `PTA-Squad-Matheus-Lins-Backend`, `PTA-Squad-Matheus-Lins-web`, and `PTA-Squad-Matheus-Lins-Mobile`.
- The backend owns ERP synchronization, credit rules, order submission, the history load, the triage agent, and every secret.
- The web and mobile clients call only the backend API.
- The churn model lives in the backend repository under `ml/`, as Python code outside `src/`. It reads the portal database and writes one risk result per customer back to it; the API only reads those results.

## Consequences

### Positive

- One place holds secrets and every ERP call, which simplifies RN-14 and RN-15.
- Each client keeps the boilerplate's tooling, CI, and architecture rules unchanged.
- The churn model shares the database schema and review flow with the API without a fourth repository.

### Negative

- The backend repository mixes Node.js and Python; `ml/` needs its own dependency file and run instructions.
- API contract changes must be coordinated across three repositories.

## Alternatives considered

### A fourth repository for data and machine learning

Gives Python its own CI, but adds a repository outside the PTA pattern and splits the database schema from the code that writes to it.

### A monorepo

Simplifies cross-cutting changes, but discards the three boilerplates and their CI, which the PTA provides as the starting point.

## References

- PRD sections 9.1 and 9.2 (architecture and technical constraints).
- DistriLux client context, section 05 ("Como as partes se ligam").
