import os
from dotenv import load_dotenv
load_dotenv()
import psycopg

conn = psycopg.connect(os.environ['DATABASE_URL'])
cur = conn.cursor()

# Check what the ANALYSIS_QUERY returns for format preference fields
cur.execute("""
WITH participants AS (
  SELECT DISTINCT participant_id
  FROM analysis_participant_allocation
),
pre_q AS (
  SELECT *
  FROM (
    SELECT participant_id, q10_format_preference,
      ROW_NUMBER() OVER (PARTITION BY participant_id ORDER BY received_at DESC, id DESC) AS rn
    FROM analysis_pre_trial_questionnaire
  ) ranked
  WHERE rn = 1
),
post_q AS (
  SELECT *
  FROM (
    SELECT participant_id, q11_format_preference,
      ROW_NUMBER() OVER (PARTITION BY participant_id ORDER BY received_at DESC, id DESC) AS rn
    FROM analysis_post_trial_questionnaire
  ) ranked
  WHERE rn = 1
)
SELECT
  p.participant_id,
  pre.q10_format_preference AS pre_format_preference,
  post.q11_format_preference AS post_format_preference
FROM participants p
LEFT JOIN pre_q pre ON pre.participant_id = p.participant_id
LEFT JOIN post_q post ON post.participant_id = p.participant_id
ORDER BY p.participant_id
""")
print("=== ANALYSIS_QUERY FORMAT PREFS ===")
for r in cur.fetchall():
    print(f'{r[0]}: pre={repr(r[1])}, post={repr(r[2])}')

conn.close()
