#!/usr/bin/env python3
import csv
import math
import os
import random
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
  import matplotlib
  matplotlib.use('Agg')
  import matplotlib.pyplot as plt
except ImportError as error:  # pragma: no cover
  raise SystemExit(
    "matplotlib is required for figure generation. Install dependencies with: pip install -r requirements.txt"
  ) from error

try:
    import psycopg
except ImportError as error:  # pragma: no cover
    raise SystemExit(
        "psycopg is required. Install dependencies with: pip install -r requirements.txt"
    ) from error

OUTPUT_DIR = Path(__file__).resolve().parent.parent / 'analysis-output'
TABLES_DIR = OUTPUT_DIR / 'tables'
REPORTS_DIR = OUTPUT_DIR / 'reports'
FIGURES_DIR = OUTPUT_DIR / 'figures'
CHAT_EVAL_DIR = OUTPUT_DIR / 'chat-eval'
WORKSPACE_DIR = Path(__file__).resolve().parent.parent
DOTENV_PATH = WORKSPACE_DIR / '.env'

ANALYSIS_QUERY = """
WITH participant_pool AS (
  SELECT DISTINCT participant_id
  FROM (
    SELECT participant_id FROM analysis_participant_allocation
    UNION ALL
    SELECT participant_id FROM analysis_telemetry_events
    UNION ALL
    SELECT participant_id FROM analysis_physical_trial_events
    UNION ALL
    SELECT participant_id FROM analysis_observer_notes
    UNION ALL
    SELECT participant_id FROM analysis_observer_step_marks
    UNION ALL
    SELECT participant_id FROM analysis_short_form_result_scores
    UNION ALL
    SELECT participant_id FROM analysis_pre_trial_questionnaire
    UNION ALL
    SELECT participant_id FROM analysis_post_trial_questionnaire
  ) src
  WHERE NULLIF(TRIM(participant_id), '') IS NOT NULL
),
mode_guess AS (
  SELECT
    participant_id,
    CASE
      WHEN SUM(CASE WHEN trial_mode = 'physical' THEN 1 ELSE 0 END) > SUM(CASE WHEN trial_mode = 'digital' THEN 1 ELSE 0 END)
        THEN 'physical'
      WHEN SUM(CASE WHEN trial_mode = 'digital' THEN 1 ELSE 0 END) > 0
        THEN 'digital'
      ELSE NULL
    END AS inferred_mode
  FROM (
    SELECT participant_id, trial_mode FROM analysis_telemetry_events
    UNION ALL
    SELECT participant_id, trial_mode FROM analysis_physical_trial_events
    UNION ALL
    SELECT participant_id, trial_mode FROM analysis_short_form_results
    UNION ALL
    SELECT participant_id, trial_mode FROM analysis_observer_notes
    UNION ALL
    SELECT participant_id, trial_mode FROM analysis_observer_step_marks
  ) modes
  WHERE NULLIF(TRIM(participant_id), '') IS NOT NULL
  GROUP BY participant_id
),
participants AS (
  SELECT
    p.participant_id,
    COALESCE(
      pa.allocation_group,
      mg.inferred_mode,
      'digital'
    ) AS allocation_group
  FROM participant_pool p
  LEFT JOIN analysis_participant_allocation pa
    ON pa.participant_id = p.participant_id
  LEFT JOIN mode_guess mg
    ON mg.participant_id = p.participant_id
),
scenario_scores AS (
  SELECT
    participant_id,
    AVG(scenario_score::DOUBLE PRECISION) AS scenario_avg_score
  FROM analysis_observer_notes
  WHERE action_type = 'scenario_score'
    AND task_id LIKE 'scenario_card_%'
    AND scenario_score IS NOT NULL
  GROUP BY participant_id
),
scenario_task_end AS (
  SELECT
    participant_id,
    COUNT(*) AS scenario_task_count,
    SUM(COALESCE(task_length_ms, 0)::DOUBLE PRECISION) / 1000.0 AS scenario_total_time_seconds,
    AVG(COALESCE(task_length_ms, 0)::DOUBLE PRECISION) / 1000.0 AS scenario_avg_time_seconds
  FROM analysis_observer_notes
  WHERE action_type = 'task_end'
    AND task_id LIKE 'scenario_card_%'
  GROUP BY participant_id
),
scenario_errors AS (
  SELECT
    participant_id,
    COUNT(*) AS scenario_error_count,
    COUNT(*) FILTER (WHERE error_severity = 'major') AS scenario_major_error_count
  FROM analysis_observer_notes
  WHERE action_type = 'error'
    AND task_id LIKE 'scenario_card_%'
  GROUP BY participant_id
),
scenario_help_per_task AS (
  SELECT
    participant_id,
    task_id,
    MAX(COALESCE(help_instances_count, 0)) AS help_instances_count
  FROM analysis_observer_notes
  WHERE task_id LIKE 'scenario_card_%'
  GROUP BY participant_id, task_id
),
scenario_help AS (
  SELECT
    participant_id,
    SUM(help_instances_count)::BIGINT AS scenario_help_count
  FROM scenario_help_per_task
  GROUP BY participant_id
),
scenario_steps AS (
  SELECT
    participant_id,
    COUNT(*) AS step_mark_count,
    AVG(CASE WHEN criterion_outcome = 'correct' THEN 1.0 ELSE 0.0 END) AS step_accuracy
  FROM analysis_observer_step_marks
  WHERE task_id LIKE 'scenario_card_%'
  GROUP BY participant_id
),
short_form AS (
  SELECT
    participant_id,
    COUNT(*) AS short_form_question_count,
    AVG(COALESCE(all_parts_correct_binary, 0)::DOUBLE PRECISION) AS short_form_binary_accuracy,
    AVG(COALESCE(proportion_correct, 0)::DOUBLE PRECISION) AS short_form_proportion_accuracy,
    AVG(NULLIF(duration_ms, 0)::DOUBLE PRECISION) / 1000.0 AS short_form_avg_duration_seconds
  FROM analysis_short_form_result_scores
  GROUP BY participant_id
),
pre_q AS (
  SELECT *
  FROM (
    SELECT
      participant_id,
      q6_digital_literacy,
      q7_digital_guidance,
      q8_physical_guidance,
      q9_problem_solving,
      ROW_NUMBER() OVER (PARTITION BY participant_id ORDER BY received_at DESC, id DESC) AS rn
    FROM analysis_pre_trial_questionnaire
  ) ranked
  WHERE rn = 1
),
post_q AS (
  SELECT *
  FROM (
    SELECT
      participant_id,
      q1_instructions_ease,
      q2_info_ease,
      q3_step_by_step_help,
      q4_instructions_satisfaction,
      q5_confidence_setup,
      q6_confidence_troubleshooting,
      q7_mental_effort,
      q8_tlx_frustration,
      q9_tlx_perceived_performance,
      q10_tlx_temporal_demand,
      ROW_NUMBER() OVER (PARTITION BY participant_id ORDER BY received_at DESC, id DESC) AS rn
    FROM analysis_post_trial_questionnaire
  ) ranked
  WHERE rn = 1
),
digital_behaviour AS (
  SELECT
    participant_id,
    COUNT(*) FILTER (WHERE event_type = 'page_view') AS digital_page_view_count,
    COUNT(*) FILTER (WHERE NULLIF(TRIM(query), '') IS NOT NULL) AS digital_search_count,
    COUNT(*) FILTER (WHERE NULLIF(TRIM(chat_message), '') IS NOT NULL) AS digital_chat_count
  FROM analysis_telemetry_events
  GROUP BY participant_id
)
SELECT
  p.participant_id,
  p.allocation_group,
  COALESCE(st.scenario_task_count, 0) AS scenario_task_count,
  st.scenario_total_time_seconds,
  st.scenario_avg_time_seconds,
  ss.scenario_avg_score,
  COALESCE(se.scenario_error_count, 0) AS scenario_error_count,
  COALESCE(se.scenario_major_error_count, 0) AS scenario_major_error_count,
  COALESCE(sh.scenario_help_count, 0) AS scenario_help_count,
  sst.step_mark_count,
  sst.step_accuracy,
  sf.short_form_question_count,
  sf.short_form_binary_accuracy,
  sf.short_form_proportion_accuracy,
  sf.short_form_avg_duration_seconds,
  pre.q6_digital_literacy,
  pre.q7_digital_guidance,
  pre.q8_physical_guidance,
  pre.q9_problem_solving,
  post.q1_instructions_ease,
  post.q2_info_ease,
  post.q3_step_by_step_help,
  post.q4_instructions_satisfaction,
  post.q5_confidence_setup,
  post.q6_confidence_troubleshooting,
  post.q7_mental_effort,
  post.q8_tlx_frustration,
  post.q9_tlx_perceived_performance,
  post.q10_tlx_temporal_demand,
  COALESCE(db.digital_page_view_count, 0) AS digital_page_view_count,
  COALESCE(db.digital_search_count, 0) AS digital_search_count,
  COALESCE(db.digital_chat_count, 0) AS digital_chat_count
FROM participants p
LEFT JOIN scenario_task_end st
  ON st.participant_id = p.participant_id
LEFT JOIN scenario_scores ss
  ON ss.participant_id = p.participant_id
LEFT JOIN scenario_errors se
  ON se.participant_id = p.participant_id
LEFT JOIN scenario_help sh
  ON sh.participant_id = p.participant_id
LEFT JOIN scenario_steps sst
  ON sst.participant_id = p.participant_id
LEFT JOIN short_form sf
  ON sf.participant_id = p.participant_id
LEFT JOIN pre_q pre
  ON pre.participant_id = p.participant_id
LEFT JOIN post_q post
  ON post.participant_id = p.participant_id
LEFT JOIN digital_behaviour db
  ON db.participant_id = p.participant_id
ORDER BY p.participant_id;
"""

PAGE_USAGE_QUERY = """
SELECT
  participant_id,
  COALESCE(NULLIF(TRIM(page_title), ''), NULLIF(TRIM(page_path), '')) AS page_label,
  page_path,
  COUNT(*) AS page_views
FROM analysis_telemetry_events
WHERE event_type = 'page_view'
  AND NULLIF(TRIM(page_path), '') IS NOT NULL
GROUP BY participant_id, COALESCE(NULLIF(TRIM(page_title), ''), NULLIF(TRIM(page_path), '')), page_path
ORDER BY page_views DESC, page_label ASC;
"""

OUTCOMES = [
    {"key": "scenario_avg_score", "label": "Scenario average score", "better": "higher"},
  {"key": "scenario_total_time_seconds", "label": "Scenario total time (s)", "better": "lower"},
    {"key": "scenario_error_count", "label": "Scenario error count", "better": "lower"},
    {"key": "scenario_major_error_count", "label": "Scenario major error count", "better": "lower"},
    {"key": "scenario_help_count", "label": "Scenario help count", "better": "lower"},
    {"key": "step_accuracy", "label": "Scenario step accuracy", "better": "higher"},
    {"key": "short_form_binary_accuracy", "label": "Short-form binary accuracy", "better": "higher"},
    {"key": "short_form_proportion_accuracy", "label": "Short-form proportion accuracy", "better": "higher"},
  {"key": "short_form_avg_duration_seconds", "label": "Short-form average duration (s)", "better": "lower"},
    {"key": "q2_info_ease", "label": "Post-trial ease finding information", "better": "higher"},
    {"key": "q5_confidence_setup", "label": "Post-trial confidence setup", "better": "higher"},
    {"key": "q7_mental_effort", "label": "Post-trial mental effort", "better": "lower"},
    {"key": "q8_tlx_frustration", "label": "Post-trial frustration", "better": "lower"},
]

STARTER_FIGURES = [
  {
    'key': 'scenario_total_time_seconds',
    'title': 'Scenario total time by group',
    'ylabel': 'Total time (s)',
    'filename': 'starter-scenario-total-time',
  },
  {
    'key': 'scenario_error_count',
    'title': 'Scenario error count by group',
    'ylabel': 'Error count',
    'filename': 'starter-scenario-error-count',
  },
  {
    'key': 'short_form_proportion_accuracy',
    'title': 'Short-form proportion accuracy by group',
    'ylabel': 'Proportion correct',
    'filename': 'starter-short-form-accuracy',
  },
]

POST_TRIAL_LIKERT_ITEMS = [
  ('q1_instructions_ease', 'Instructions easy'),
  ('q2_info_ease', 'Info easy to find'),
  ('q3_step_by_step_help', 'Step-by-step help'),
  ('q4_instructions_satisfaction', 'Instructions satisfaction'),
  ('q5_confidence_setup', 'Confidence setup'),
  ('q6_confidence_troubleshooting', 'Confidence troubleshoot'),
  ('q7_mental_effort', 'Mental effort'),
  ('q8_tlx_frustration', 'Frustration'),
  ('q9_tlx_perceived_performance', 'Perceived performance'),
  ('q10_tlx_temporal_demand', 'Temporal demand'),
]


def load_dotenv(dotenv_path: Path) -> None:
    if not dotenv_path.exists():
        return

    for raw_line in dotenv_path.read_text(encoding='utf8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue

        key, value = line.split('=', 1)
        key = key.strip()
        if not key:
            continue

        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]

        os.environ[key] = value


def to_number(value: Any) -> float | int | None:
    if value in (None, ''):
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        if isinstance(value, float) and math.isnan(value):
            return None
        return value
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number):
        return None
    return int(number) if number.is_integer() else number


def mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def median(values: list[float]) -> float | None:
    if not values:
        return None
    sorted_values = sorted(values)
    mid = len(sorted_values) // 2
    if len(sorted_values) % 2:
        return sorted_values[mid]
    return (sorted_values[mid - 1] + sorted_values[mid]) / 2


def sample_sd(values: list[float]) -> float | None:
    if len(values) < 2:
        return None
    avg = mean(values)
    assert avg is not None
    variance = sum((value - avg) ** 2 for value in values) / (len(values) - 1)
    return math.sqrt(variance)


def quantile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    sorted_values = sorted(values)
    pos = (len(sorted_values) - 1) * q
    base = math.floor(pos)
    rest = pos - base
    lower = sorted_values[base]
    upper = sorted_values[base + 1] if base + 1 < len(sorted_values) else lower
    return lower + rest * (upper - lower)


def cliffs_delta(group_a: list[float], group_b: list[float]) -> float | None:
    if not group_a or not group_b:
        return None
    greater = 0
    lesser = 0
    for a_value in group_a:
        for b_value in group_b:
            if a_value > b_value:
                greater += 1
            elif a_value < b_value:
                lesser += 1
    return (greater - lesser) / (len(group_a) * len(group_b))


def permutation_p_value(group_a: list[float], group_b: list[float], iterations: int = 5000) -> float | None:
    if len(group_a) < 2 or len(group_b) < 2:
        return None
    observed = abs((mean(group_a) or 0) - (mean(group_b) or 0))
    combined = list(group_a) + list(group_b)
    size_a = len(group_a)
    rng = random.Random(42)
    extreme = 0

    for _ in range(iterations):
        rng.shuffle(combined)
        perm_a = combined[:size_a]
        perm_b = combined[size_a:]
        diff = abs((mean(perm_a) or 0) - (mean(perm_b) or 0))
        if diff >= observed:
            extreme += 1

    return (extreme + 1) / (iterations + 1)


def summarize(values: list[float]) -> dict[str, float | int | None]:
    if not values:
        return {"n": 0, "mean": None, "sd": None, "median": None, "q1": None, "q3": None}
    return {
        "n": len(values),
        "mean": mean(values),
        "sd": sample_sd(values),
        "median": median(values),
        "q1": quantile(values, 0.25),
        "q3": quantile(values, 0.75),
    }


def format_number(value: Any, digits: int = 3) -> str:
    if value is None:
        return 'NA'
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 'NA'
    if math.isnan(number):
        return 'NA'
    return f"{number:.{digits}f}"


def format_mean_sd(mean_value: Any, sd_value: Any, digits: int = 3) -> str:
    mean_text = format_number(mean_value, digits)
    sd_text = format_number(sd_value, digits)
    if mean_text == 'NA':
        return 'NA'
    if sd_text == 'NA':
        return mean_text
    return f'{mean_text} ± {sd_text}'


def format_median_iqr(median_value: Any, q1_value: Any, q3_value: Any, digits: int = 3) -> str:
    median_text = format_number(median_value, digits)
    q1_text = format_number(q1_value, digits)
    q3_text = format_number(q3_value, digits)
    if median_text == 'NA':
        return 'NA'
    if q1_text == 'NA' or q3_text == 'NA':
        return median_text
    return f'{median_text} [{q1_text}, {q3_text}]'


def build_report_ready_rows(test_rows: list[dict[str, Any]]) -> list[dict[str, str | int]]:
    rows: list[dict[str, str | int]] = []
    for row in test_rows:
        rows.append({
            'Outcome': str(row['label']),
            'Digital n': int(row['digital_n']),
            'Digital mean ± SD': format_mean_sd(row['digital_mean'], row['digital_sd']),
            'Digital median [Q1, Q3]': format_median_iqr(row['digital_median'], row['digital_q1'], row['digital_q3']),
            'Physical n': int(row['physical_n']),
            'Physical mean ± SD': format_mean_sd(row['physical_mean'], row['physical_sd']),
            'Physical median [Q1, Q3]': format_median_iqr(row['physical_median'], row['physical_q1'], row['physical_q3']),
            'Mean diff (D-P)': format_number(row['mean_diff']),
            'Permutation p': format_number(row['permutation_p_value'], 4),
            "Cliff's delta": format_number(row['cliffs_delta']),
        })
    return rows


def to_markdown_table(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return ''

    columns = list(rows[0].keys())
    header = '| ' + ' | '.join(columns) + ' |'
    separator = '| ' + ' | '.join('---' for _ in columns) + ' |'
    body = []
    for row in rows:
        body.append('| ' + ' | '.join(str(row.get(column, '')) for column in columns) + ' |')
    return '\n'.join([header, separator, *body]) + '\n'


def to_csv(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return ''
    fieldnames = list(rows[0].keys())
    from io import StringIO

    buffer = StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, lineterminator='\n')
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue()


def ensure_directories() -> None:
    TABLES_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    CHAT_EVAL_DIR.mkdir(parents=True, exist_ok=True)


def clear_previous_outputs() -> list[str]:
    cleared: list[str] = []
    managed_directories = [TABLES_DIR, REPORTS_DIR, FIGURES_DIR, CHAT_EVAL_DIR]

    for directory in managed_directories:
        if not directory.exists():
            continue
        for path in directory.iterdir():
            if not path.is_file():
                continue
            if '-latest.' in path.name:
                continue
            path.unlink()
            cleared.append(str(path))

    return cleared


def shorten_label(value: str, max_length: int = 42) -> str:
    text = str(value or '').strip()
    if len(text) <= max_length:
        return text
    return f"{text[:max_length - 1].rstrip()}…"


def save_figure(fig: Any, stem: str, timestamp: str) -> tuple[Path, Path]:
    timestamped = FIGURES_DIR / f'{stem}-{timestamp}.png'
    latest = FIGURES_DIR / f'{stem}-latest.png'
    fig.savefig(timestamped, dpi=200, bbox_inches='tight')
    fig.savefig(latest, dpi=200, bbox_inches='tight')
    plt.close(fig)
    return timestamped, latest


def create_group_distribution_figure(rows: list[dict[str, Any]], key: str, title: str, ylabel: str) -> Any | None:
    groups = [('digital', '#2563eb'), ('physical', '#dc2626')]
    values_by_group: list[list[float]] = []
    colors: list[str] = []
    for group_name, color in groups:
        values = [float(row[key]) for row in rows if row.get('allocation_group') == group_name and to_number(row.get(key)) is not None]
        values_by_group.append(values)
        colors.append(color)

    if not any(values_by_group):
        return None

    fig, ax = plt.subplots(figsize=(7.5, 5))
    valid_positions = []
    valid_values = []
    valid_colors = []
    valid_labels = []
    for idx, ((group_name, color), values) in enumerate(zip(groups, values_by_group), start=1):
        if not values:
            continue
        valid_positions.append(idx)
        valid_values.append(values)
        valid_colors.append(color)
        valid_labels.append(group_name.title())

    bp = ax.boxplot(valid_values, positions=valid_positions, patch_artist=True, widths=0.5, showfliers=False)
    for patch, color in zip(bp['boxes'], valid_colors):
        patch.set(facecolor=color, alpha=0.28, edgecolor=color, linewidth=1.5)
    for median_line in bp['medians']:
        median_line.set(color='#111827', linewidth=1.5)

    rng = random.Random(42)
    for position, values, color in zip(valid_positions, valid_values, valid_colors):
        jitter = [position + rng.uniform(-0.08, 0.08) for _ in values]
        ax.scatter(jitter, values, color=color, alpha=0.8, s=28, edgecolors='white', linewidths=0.4)
        ax.scatter([position], [sum(values) / len(values)], color='#111827', marker='D', s=48, zorder=4)

    ax.set_xticks(valid_positions)
    ax.set_xticklabels(valid_labels)
    ax.set_title(title)
    ax.set_ylabel(ylabel)
    ax.grid(axis='y', linestyle=':', alpha=0.4)
    return fig


def create_post_trial_likert_figure(rows: list[dict[str, Any]]) -> Any | None:
    grouped_rows = {
        'digital': [row for row in rows if row.get('allocation_group') == 'digital'],
        'physical': [row for row in rows if row.get('allocation_group') == 'physical'],
    }

    if not any(grouped_rows.values()):
        return None

    colors = {
        1: '#b91c1c',
        2: '#ef4444',
        3: '#d1d5db',
        4: '#60a5fa',
        5: '#1d4ed8',
    }
    fig, axes = plt.subplots(1, 2, figsize=(15, 8), sharey=True)
    has_any_data = False

    for ax, (group_name, group_rows) in zip(axes, grouped_rows.items()):
        item_labels: list[str] = []
        distributions: list[dict[int, float]] = []
        for key, label in POST_TRIAL_LIKERT_ITEMS:
            numeric = [int(to_number(row.get(key))) for row in group_rows if to_number(row.get(key)) in {1, 2, 3, 4, 5}]
            if not numeric:
                continue
            has_any_data = True
            total = len(numeric)
            percentages = {score: (numeric.count(score) / total) * 100 for score in range(1, 6)}
            item_labels.append(label)
            distributions.append(percentages)

        if not distributions:
            ax.set_title(f'{group_name.title()} (no post-trial data)')
            ax.axis('off')
            continue

        y_positions = list(range(len(item_labels)))
        for idx, percentages in enumerate(distributions):
            negative_left = -(percentages[1] + percentages[2] + (percentages[3] / 2))
            ax.barh(idx, percentages[1], left=negative_left, color=colors[1], edgecolor='white', height=0.75)
            ax.barh(idx, percentages[2], left=negative_left + percentages[1], color=colors[2], edgecolor='white', height=0.75)
            ax.barh(idx, percentages[3] / 2, left=-(percentages[3] / 2), color=colors[3], edgecolor='white', height=0.75)
            ax.barh(idx, percentages[3] / 2, left=0, color=colors[3], edgecolor='white', height=0.75)
            ax.barh(idx, percentages[4], left=percentages[3] / 2, color=colors[4], edgecolor='white', height=0.75)
            ax.barh(idx, percentages[5], left=(percentages[3] / 2) + percentages[4], color=colors[5], edgecolor='white', height=0.75)

        ax.axvline(0, color='#111827', linewidth=0.8)
        ax.set_yticks(y_positions)
        ax.set_yticklabels(item_labels)
        ax.invert_yaxis()
        ax.set_title(f'{group_name.title()} post-trial responses')
        ax.set_xlabel('Response distribution (%)')
        ax.set_xlim(-100, 100)
        ax.grid(axis='x', linestyle=':', alpha=0.35)

    if not has_any_data:
        plt.close(fig)
        return None

    handles = [plt.Rectangle((0, 0), 1, 1, color=colors[score]) for score in range(1, 6)]
    fig.legend(handles, ['1', '2', '3', '4', '5'], loc='lower center', ncol=5, frameon=False, title='Likert response')
    fig.suptitle('Post-trial questionnaire response distributions', fontsize=14)
    fig.tight_layout(rect=(0, 0.05, 1, 0.96))
    return fig


def create_ranked_page_use_figure(page_usage_rows: list[dict[str, Any]], digital_participant_ids: set[str]) -> Any | None:
    page_totals: dict[str, dict[str, Any]] = {}
    for row in page_usage_rows:
        participant_id = str(row.get('participant_id') or '').strip()
        if not participant_id or participant_id not in digital_participant_ids:
            continue
        label = str(row.get('page_label') or row.get('page_path') or '').strip()
        if not label:
            continue
        entry = page_totals.setdefault(label, {'views': 0, 'participants': set()})
        entry['views'] += int(to_number(row.get('page_views')) or 0)
        entry['participants'].add(participant_id)

    ranked = sorted(
        (
            {
                'label': label,
                'views': values['views'],
                'participant_count': len(values['participants']),
            }
            for label, values in page_totals.items()
        ),
        key=lambda row: (-row['views'], row['label'].lower()),
    )[:10]

    if not ranked:
        return None

    ranked.reverse()
    labels = [shorten_label(row['label']) for row in ranked]
    views = [row['views'] for row in ranked]
    participant_counts = [row['participant_count'] for row in ranked]

    fig, ax = plt.subplots(figsize=(10, 6.5))
    bars = ax.barh(labels, views, color='#2563eb', alpha=0.8)
    ax.set_title('Most-viewed digital guide pages')
    ax.set_xlabel('Page views')
    ax.set_ylabel('Page')
    ax.grid(axis='x', linestyle=':', alpha=0.35)

    max_view = max(views) if views else 0
    for bar, participant_count in zip(bars, participant_counts):
        ax.text(
            bar.get_width() + max(max_view * 0.015, 0.2),
            bar.get_y() + (bar.get_height() / 2),
            f"n={participant_count}",
            va='center',
            ha='left',
            fontsize=9,
            color='#111827',
        )

    return fig


def generate_figures(participant_rows: list[dict[str, Any]], page_usage_rows: list[dict[str, Any]], timestamp: str) -> list[dict[str, str]]:
    figure_outputs: list[dict[str, str]] = []

    for config in STARTER_FIGURES:
        fig = create_group_distribution_figure(participant_rows, config['key'], config['title'], config['ylabel'])
        if fig is None:
            continue
        timestamped, latest = save_figure(fig, config['filename'], timestamp)
        figure_outputs.append({
            'label': config['title'],
            'timestamped_path': str(timestamped),
            'latest_path': str(latest),
        })

    likert_fig = create_post_trial_likert_figure(participant_rows)
    if likert_fig is not None:
        timestamped, latest = save_figure(likert_fig, 'starter-post-trial-likert', timestamp)
        figure_outputs.append({
            'label': 'Post-trial questionnaire response distributions',
            'timestamped_path': str(timestamped),
            'latest_path': str(latest),
        })

    digital_participant_ids = {
        str(row.get('participant_id') or '').strip()
        for row in participant_rows
        if row.get('allocation_group') == 'digital'
    }
    page_use_fig = create_ranked_page_use_figure(page_usage_rows, digital_participant_ids)
    if page_use_fig is not None:
        timestamped, latest = save_figure(page_use_fig, 'starter-digital-page-use', timestamp)
        figure_outputs.append({
            'label': 'Most-viewed digital guide pages',
            'timestamped_path': str(timestamped),
            'latest_path': str(latest),
        })

    return figure_outputs


def get_timestamp() -> str:
    return datetime.now().strftime('%Y%m%d-%H%M%S')


def build_report(participant_rows: list[dict[str, Any]], test_rows: list[dict[str, Any]], group_summary_rows: list[dict[str, Any]], generated_at: str, figure_outputs: list[dict[str, str]]) -> str:
    group_counts = ', '.join(
        f"{row['group']}: n={row['n']}"
        for row in group_summary_rows
        if row['metric'] == '_participants'
    )

    top_signals = sorted(
        (row for row in test_rows if row['permutation_p_value'] is not None),
        key=lambda row: row['permutation_p_value'],
    )[:5]

    lines = [
        '# CPAP Trial Statistical Report (On-Demand)',
        '',
        f'Generated at: {generated_at}',
        f'Participants analyzed: {len(participant_rows)}',
        f'Group sizes: {group_counts or "NA"}',
        '',
        '## Summary table (group comparison)',
        '',
        "| Outcome | Digital n | Physical n | Digital mean | Physical mean | Mean diff (Digital - Physical) | Permutation p | Cliff's delta |",
        '|---|---:|---:|---:|---:|---:|---:|---:|',
    ]

    for row in test_rows:
        lines.append(
            f"| {row['label']} | {row['digital_n']} | {row['physical_n']} | {format_number(row['digital_mean'])} | {format_number(row['physical_mean'])} | {format_number(row['mean_diff'])} | {format_number(row['permutation_p_value'], 4)} | {format_number(row['cliffs_delta'])} |"
        )

    report_ready_rows = build_report_ready_rows(test_rows)
    lines.extend(['', '## Dissertation-ready table', ''])
    lines.extend(to_markdown_table(report_ready_rows).strip().splitlines())

    lines.extend(['', '## Quick interpretation', ''])
    if not top_signals:
        lines.append('- Insufficient data for inferential comparisons (need at least 2 participants per group per outcome).')
    else:
        for row in top_signals:
            lines.append(
                f"- {row['label']}: mean difference = {format_number(row['mean_diff'])}, permutation p = {format_number(row['permutation_p_value'], 4)} ({row['better_direction_hint']})."
            )

    lines.extend([
        '',
        '## Figures generated',
        '',
    ])
    if not figure_outputs:
        lines.append('- No figures were generated (likely insufficient data).')
    else:
        for figure in figure_outputs:
            lines.append(f"- {figure['label']}: {figure['latest_path']}")

    lines.extend([
        '',
        '## Notes',
        '',
        '- This report is generated on demand from PostgreSQL (no scheduled timer).',
        '- P-values are permutation-based (default 5,000 shuffles) to reduce distributional assumptions for small samples.',
        '- Confirm primary endpoint definitions with your supervisor before final dissertation submission.',
        '',
    ])
    return '\n'.join(lines)


def fetch_query_rows(database_url: str, query: str) -> list[dict[str, Any]]:
  connect_kwargs: dict[str, Any] = {}
  if os.environ.get('PGSSLMODE') == 'require':
    connect_kwargs['sslmode'] = 'require'

  with psycopg.connect(database_url, **connect_kwargs) as connection:
    with connection.cursor() as cursor:
      cursor.execute(query)
      columns = [desc.name for desc in cursor.description]
      return [dict(zip(columns, row)) for row in cursor.fetchall()]


def fetch_rows(database_url: str) -> list[dict[str, Any]]:
  return fetch_query_rows(database_url, ANALYSIS_QUERY)


def fetch_page_usage_rows(database_url: str) -> list[dict[str, Any]]:
  return fetch_query_rows(database_url, PAGE_USAGE_QUERY)


def normalize_participant_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized_rows: list[dict[str, Any]] = []
    for row in rows:
        normalized = dict(row)
        for key, value in list(normalized.items()):
            if key in {'participant_id', 'allocation_group'}:
                continue
            normalized[key] = to_number(value)
        normalized_rows.append(normalized)
    return normalized_rows


def main() -> int:
    load_dotenv(DOTENV_PATH)
    database_url = os.environ.get('DATABASE_URL')
    if not database_url:
        print('DATABASE_URL is required. Set it in the environment or add it to a .env file in the workspace root.', file=sys.stderr)
        return 1

    participant_rows = normalize_participant_rows(fetch_rows(database_url))
    page_usage_rows = fetch_page_usage_rows(database_url)
    digital_rows = [row for row in participant_rows if row.get('allocation_group') == 'digital']
    physical_rows = [row for row in participant_rows if row.get('allocation_group') == 'physical']

    test_rows: list[dict[str, Any]] = []
    for outcome in OUTCOMES:
        digital_values = [float(row[outcome['key']]) for row in digital_rows if to_number(row.get(outcome['key'])) is not None]
        physical_values = [float(row[outcome['key']]) for row in physical_rows if to_number(row.get(outcome['key'])) is not None]

        digital_summary = summarize(digital_values)
        physical_summary = summarize(physical_values)
        mean_diff = None
        if digital_summary['mean'] is not None and physical_summary['mean'] is not None:
            mean_diff = float(digital_summary['mean']) - float(physical_summary['mean'])

        test_rows.append({
            'outcome_key': outcome['key'],
            'label': outcome['label'],
            'better_direction_hint': outcome['better'],
            'digital_n': digital_summary['n'],
            'physical_n': physical_summary['n'],
            'digital_mean': digital_summary['mean'],
            'physical_mean': physical_summary['mean'],
            'digital_sd': digital_summary['sd'],
            'physical_sd': physical_summary['sd'],
            'digital_median': digital_summary['median'],
            'physical_median': physical_summary['median'],
          'digital_q1': digital_summary['q1'],
          'digital_q3': digital_summary['q3'],
          'physical_q1': physical_summary['q1'],
          'physical_q3': physical_summary['q3'],
            'mean_diff': mean_diff,
            'permutation_p_value': permutation_p_value(digital_values, physical_values),
            'cliffs_delta': cliffs_delta(digital_values, physical_values),
        })

    group_summary_rows: list[dict[str, Any]] = [
        {'metric': '_participants', 'group': 'digital', 'n': len(digital_rows), 'mean': None, 'sd': None, 'median': None, 'q1': None, 'q3': None},
        {'metric': '_participants', 'group': 'physical', 'n': len(physical_rows), 'mean': None, 'sd': None, 'median': None, 'q1': None, 'q3': None},
    ]

    for outcome in OUTCOMES:
        for group_name, rows in (('digital', digital_rows), ('physical', physical_rows)):
            values = [float(row[outcome['key']]) for row in rows if to_number(row.get(outcome['key'])) is not None]
            summary = summarize(values)
            group_summary_rows.append({
                'metric': outcome['key'],
                'group': group_name,
                'n': summary['n'],
                'mean': summary['mean'],
                'sd': summary['sd'],
                'median': summary['median'],
                'q1': summary['q1'],
                'q3': summary['q3'],
            })

    ensure_directories()
    cleared_outputs = clear_previous_outputs()
    timestamp = get_timestamp()
    generated_at = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    figure_outputs = generate_figures(participant_rows, page_usage_rows, timestamp)

    participant_csv = to_csv(participant_rows)
    tests_csv = to_csv(test_rows)
    summary_csv = to_csv(group_summary_rows)
    report_ready_rows = build_report_ready_rows(test_rows)
    report_ready_csv = to_csv(report_ready_rows)
    report_ready_md = to_markdown_table(report_ready_rows)
    report = build_report(participant_rows, test_rows, group_summary_rows, generated_at, figure_outputs)

    participant_file = TABLES_DIR / f'participant-level-{timestamp}.csv'
    tests_file = TABLES_DIR / f'outcome-tests-{timestamp}.csv'
    summary_file = TABLES_DIR / f'group-summary-{timestamp}.csv'
    report_ready_csv_file = TABLES_DIR / f'dissertation-summary-table-{timestamp}.csv'
    report_ready_md_file = TABLES_DIR / f'dissertation-summary-table-{timestamp}.md'
    report_file = REPORTS_DIR / f'stats-report-{timestamp}.md'

    participant_file.write_text(participant_csv, encoding='utf8')
    tests_file.write_text(tests_csv, encoding='utf8')
    summary_file.write_text(summary_csv, encoding='utf8')
    report_ready_csv_file.write_text(report_ready_csv, encoding='utf8')
    report_ready_md_file.write_text(report_ready_md, encoding='utf8')
    report_file.write_text(report, encoding='utf8')

    (TABLES_DIR / 'participant-level-latest.csv').write_text(participant_csv, encoding='utf8')
    (TABLES_DIR / 'outcome-tests-latest.csv').write_text(tests_csv, encoding='utf8')
    (TABLES_DIR / 'group-summary-latest.csv').write_text(summary_csv, encoding='utf8')
    (TABLES_DIR / 'dissertation-summary-table-latest.csv').write_text(report_ready_csv, encoding='utf8')
    (TABLES_DIR / 'dissertation-summary-table-latest.md').write_text(report_ready_md, encoding='utf8')
    (REPORTS_DIR / 'stats-report-latest.md').write_text(report, encoding='utf8')

    print('Stats report generated successfully.')
    if cleared_outputs:
      print(f'- Cleared {len(cleared_outputs)} previous analysis output(s).')
    print(f'- {report_file}')
    print(f'- {participant_file}')
    print(f'- {tests_file}')
    print(f'- {summary_file}')
    print(f'- {report_ready_csv_file}')
    print(f'- {report_ready_md_file}')
    for figure in figure_outputs:
      print(f"- {figure['timestamped_path']}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
