# ml/: data and machine learning

Python code for the DistriLux data work: the legacy spreadsheets profile (F11, US-011) and the churn-risk model (F26). It lives outside `src/` and is not part of the Node.js build. See ADR 0001.

## Layout

```text
ml/
├── requirements.txt        pinned Python dependencies
├── pytest.ini              test configuration
├── legacy_profile/         tested package: readers, format and duplicate detection,
│                           reference and anomaly checks, ERP cross-check, report
├── scripts/export_erp.py   one-off export of ERP customers, products, and receivables
├── notebooks/              analysis notebooks; they only call the packages
├── tests/                  pytest suite with synthetic data only
└── data/raw/               original client files and ERP export (ignored by Git)
```

Rules for this folder:

- `ml/data/raw/` holds client data with CNPJs and names. Only its `.gitkeep` is versioned; never commit its content.
- Never edit, convert, or re-save the original spreadsheets. Copy them byte for byte into `ml/data/raw/`.
- Commit notebooks with outputs cleared, because outputs can contain client data.
- Logic goes in a package with tests; notebooks only call it.

## Environment setup

Requires Python 3.12. From the repository root (PowerShell):

```powershell
py -3.12 -m venv ml/.venv
ml/.venv/Scripts/python -m pip install -r ml/requirements.txt
```

On macOS or Linux, use `python3.12 -m venv ml/.venv` and `ml/.venv/bin/python`.

## Run the tests

```powershell
cd ml
.venv/Scripts/python -m pytest
```

The tests use synthetic data and a fake ERP, so they need neither the client files nor network access.

## Legacy spreadsheets profile (F11)

1. Copy `Clientes - Comercial.xlsx`, `Pedidos 2025-2026 - Comercial.xlsx`, and `titulos.csv` into `ml/data/raw/` without opening them.
2. Export the ERP lists used for the cross-check. The key stays in the environment and is never written to disk:

   ```powershell
   $env:ERP_API_KEY = "<team key>"
   ml/.venv/Scripts/python ml/scripts/export_erp.py
   ```

   This writes `ml/data/raw/erp/{clientes,produtos,titulos}.json`. `ERP_BASE_URL` is optional and defaults to `https://pta-erp-api.onrender.com`.

3. Run the notebook:

   ```powershell
   ml/.venv/Scripts/python -m jupyter nbconvert --to notebook --execute --inplace ml/notebooks/01-legacy-profile.ipynb
   ```

   It writes the tables to `ml/data/raw/profile-tables.md`. Clear the outputs before committing:

   ```powershell
   ml/.venv/Scripts/python -m jupyter nbconvert --clear-output --inplace ml/notebooks/01-legacy-profile.ipynb
   ```

The result is published in `docs/data/legacy-spreadsheets-profile.md`.

## Churn model (F26)

### Contract with the API

- Input: the cleaned history of orders and receivables in the portal database.
- Output: one row per active customer with calculation date, probability, band (high, medium, or low), main reason in plain language, and model version.
- Validation uses a period after the training period and must beat the rule "more than 60 days without buying".

### Layout

To be defined by the data owner in the first F26 change: training script and scoring script, following the folder rules above.
