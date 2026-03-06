# AirSense 10 User Guide

Interactive training materials and user guide for the AirSense 10 CPAP device.

## Short-form scoring rubric (SQL)

The database schema includes an automated rubric scoring system for short-form trial questions.

- Rubric rules table: `short_form_rubric_rules`
- Per-response answer scoring view: `short_form_part_scoring` (single part: `a`)
- Per-response aggregate scoring view: `short_form_result_scores`

### How it works

1. Responses are captured in `short_form_results`.
2. Answers are normalized (`normalize_short_form_text`) and matched against active rules.
3. Matching rule => score `1` (or configured `score_value`), no match => `0` and `needs_manual_review=true`.
4. Aggregate outputs include `proportion_correct` and `all_parts_correct_binary`.

Some high-priority rules are configured as reject guards with `score_value = 0` (for example clearly contradictory statements). These are evaluated first via `rule_order`.

Supported `match_type` values:

- `exact` — exact normalized match
- `contains` — answer contains one normalized phrase
- `contains_any` — answer contains any term from `match_value` split by `||`
- `contains_all` — answer contains all terms from `match_value` split by `||`
- `regex` — case-insensitive regex on raw answer text
- `numeric_range` — first numeric value in answer falls within range

Normalization also maps common wording/typos (for example `wekly` -> `weekly`, `get in touch` -> `contact`, `feet/foot` -> `ft`, `celsius` -> `c`).

### Adjust acceptable answers

Update rules by inserting a new `rubric_version` (recommended) and setting old rules to `is_active=false` when ready.

Example query for scored outputs:

```sql
SELECT
	participant_id,
	question_id,
	all_parts_correct_binary,
	proportion_correct,
	has_any_manual_review_flag
FROM short_form_result_scores
ORDER BY received_at DESC;
```

Example query for rule-level matching diagnostics:

```sql
SELECT
	short_form_result_id,
	participant_id,
	question_id,
	part_key,
	answer_text,
	matched_rule_id,
	rule_label,
	score_binary,
	needs_manual_review
FROM short_form_part_scoring
ORDER BY received_at DESC;
```

## Features

- Complete device documentation
- Search functionality across all pages
- Responsive design
- Comprehensive technical specifications
- Troubleshooting guides
- Device care and maintenance instructions 

## On-demand ETL + statistical report

You can generate participant-level ETL outputs and a markdown stats report on demand (no timer) from your PostgreSQL trial database.

### Prerequisites

- `DATABASE_URL` environment variable set to your telemetry PostgreSQL database.
- Node dependencies installed (`npm install`).

### Run

```bash
npm run stats:report
```

### Outputs

Generated files are written to:

- `analysis-output/reports/stats-report-latest.md`
- `analysis-output/tables/participant-level-latest.csv`
- `analysis-output/tables/outcome-tests-latest.csv`
- `analysis-output/tables/group-summary-latest.csv`

Timestamped versions are also created on each run.
