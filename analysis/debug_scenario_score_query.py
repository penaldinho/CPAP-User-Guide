import importlib.util
from pathlib import Path

module_path = Path(r"c:\Users\edfre\OneDrive\Documents\GitHub\CPAP-User-Guide\analysis\run-stats-report.py")
spec = importlib.util.spec_from_file_location("run_stats_report", module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.load_dotenv(module.DOTENV_PATH)
database_url = module.os.environ.get("DATABASE_URL")
rows = module.fetch_query_rows(
    database_url,
    """
    SELECT
      participant_id,
      task_id,
      COALESCE(NULLIF(trial_mode, ''), 'digital') AS trial_mode,
      AVG(scenario_score::DOUBLE PRECISION) AS scenario_score
    FROM analysis_observer_notes
    WHERE action_type = 'scenario_score'
      AND scenario_score IS NOT NULL
      AND task_id = 'scenario_card_1'
    GROUP BY participant_id, task_id, COALESCE(NULLIF(trial_mode, ''), 'digital')
    ORDER BY participant_id
    """,
)
output_path = Path(r"c:\Users\edfre\OneDrive\Documents\GitHub\CPAP-User-Guide\analysis-output\reports\debug-scenario-score-join.txt")
output_path.write_text("\n".join(str(row) for row in rows), encoding="utf8")
print(output_path)
print(len(rows))
