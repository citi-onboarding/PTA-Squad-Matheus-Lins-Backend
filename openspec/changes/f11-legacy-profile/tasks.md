## 1. SDD

- [x] 1.1 Write proposal, legacy-history spec, design, and tasks for F11 (US-011, RN-09, RN-16)
- [x] 1.2 Run `pnpm exec openspec validate f11-legacy-profile --strict`

## 2. Red

- [x] 2.1 Set up `ml/` with a Python 3.12 virtual environment, a pinned `ml/requirements.txt`, `ml/pytest.ini`, and Git ignore rules for `ml/data/raw/`, `ml/.venv/`, and Python caches
- [x] 2.2 Developer writes the tests with synthetic data, one per spec scenario: file reading, structure and format inventory, duplicates, reference quality, suspicious rows, ERP cross-check, problem report, reconciliation, privacy guard, and ERP export
- [x] 2.3 Add stubs with the final signatures that return empty results
- [x] 2.4 Run `ml/.venv/Scripts/python -m pytest ml` and confirm every test fails on its assertion

## 3. Green

- [x] 3.1 Implement readers, format classification, duplicate detection, reference quality, and suspicious-row detection
- [x] 3.2 Implement the ERP cross-check, problem report with rule table, reconciliation, and privacy guard
- [x] 3.3 Implement the ERP export with pagination, `Retry-After` handling, and the key read from `ERP_API_KEY`
- [x] 3.4 Run `ml/.venv/Scripts/python -m pytest ml` and confirm every test passes

## 4. Refactor

- [x] 4.1 Remove duplication and clarify names without changing behavior
- [x] 4.2 Run `ml/.venv/Scripts/python -m pytest ml` and confirm the suite stays green

## 5. Consolidation

- [x] 5.1 Export the ERP lists and place the three original files in `ml/data/raw/` without editing them
- [x] 5.2 Run `ml/notebooks/01-legacy-profile.ipynb` on the real files and commit it with outputs cleared
- [x] 5.3 Write `docs/data/legacy-spreadsheets-profile.md` with counts, code-only examples, proposed rules, reconciliation per file, ERP cross-check, and the sprint 2 load recommendation
- [x] 5.4 Document the environment setup and commands in `ml/README.md`
- [x] 5.5 Confirm `git status` lists nothing under `ml/data/raw/`
- [x] 5.6 Run `pnpm format:check`, `pnpm verify` (typecheck, lint, tests, and `openspec validate --strict`), and the Python suite
- [x] 5.7 Write `docs/changes/f11-legacy-profile.md` from the template and evaluate the ADR decision
