# Churn model

Python code that trains and runs the DistriLux churn-risk model (F26, US-026, RN-18, RN-20). It lives outside `src/` and is not part of the Node.js build. See ADR 0001.

## Contract with the API

- Input: the cleaned history of orders and receivables in the portal database.
- Output: one row per active customer with calculation date, probability, band (high, medium, or low), main reason in plain language, and model version.
- Validation uses a period after the training period and must beat the rule "more than 60 days without buying".

## Layout

To be defined by the data owner in the first F26 change: dependency file, notebooks, training script, and scoring script.
