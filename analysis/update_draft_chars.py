"""Apply two targeted edits to MSc-Report-Draft.md (CRLF file):
1. §A Participant Characteristics — add education, occupation, device experience
2. §I Limitations — add occupational profile caveat
"""

filepath = 'Write Up/MSc-Report-Draft.md'

with open(filepath, 'rb') as f:
    raw = f.read()

text = raw.decode('utf-8')

# -----------------------------------------------------------------------
# EDIT 1 — §A Participant Characteristics (line 118, 0-indexed 117)
# Replace the single §A paragraph with expanded version
# -----------------------------------------------------------------------

OLD_A = (
    "A total of 30 participants were enrolled and completed the study, with 15 allocated to each group. "
    "Participant ages ranged from 18 to 84 years (overall mean 34.1 \u00b1 15.6), with similar means between groups "
    "(digital 35.5 \u00b1 13.4; paper 32.8 \u00b1 17.9). Both groups reported high self-rated digital literacy (median 4/5 in each group). "
    "Table I summarises baseline characteristics. Mann\u2013Whitney U tests confirmed no significant between-group differences on any baseline measure: "
    "age (U\u00a0=\u00a083.5, p\u00a0=\u00a00.235), digital literacy (U\u00a0=\u00a092.5, p\u00a0=\u00a00.346), "
    "digital guidance confidence (U\u00a0=\u00a0106.0, p\u00a0=\u00a00.772), paper guidance confidence (U\u00a0=\u00a096.0, p\u00a0=\u00a00.438), "
    "and problem-solving confidence (U\u00a0=\u00a075.0, p\u00a0=\u00a00.086). "
    "The groups were therefore considered comparable at baseline."
)

NEW_A = (
    "A total of 30 participants were enrolled and completed the study, with 15 allocated to each group. "
    "Participant ages ranged from 18 to 84 years (overall mean 34.1 \u00b1 15.6), with similar means between groups "
    "(digital 35.5 \u00b1 13.4; paper 32.8 \u00b1 17.9). Both groups reported high self-rated digital literacy (median 4/5 in each group). "
    "The majority of participants held postgraduate qualifications (digital 12/15, 80%; paper 9/15, 60%; total 21/30, 70%), "
    "with the remainder holding a university degree (7/30, 23%) or secondary-level education (2/30, 7%; both in the paper group). "
    "Twenty of 30 participants (67%) reported prior experience with at least one home monitoring device, "
    "most commonly a blood pressure monitor or sleep/fitness tracker (n\u00a0=\u00a013 each); no participant had prior experience "
    "with a respiratory therapy device, consistent with the eligibility criteria. "
    "Seventy per cent of participants (21/30) were employed or training in clinical science or clinical engineering roles "
    "(digital 11/15, 73%; paper 10/15, 67%), with the remainder in non-healthcare occupations (n\u00a0=\u00a03) or not stating an occupation (n\u00a0=\u00a06). "
    "Table I summarises baseline characteristics. "
    "Mann\u2013Whitney U tests confirmed no significant between-group differences on any baseline measure: "
    "age (U\u00a0=\u00a083.5, p\u00a0=\u00a00.235), digital literacy (U\u00a0=\u00a092.5, p\u00a0=\u00a00.346), "
    "digital guidance confidence (U\u00a0=\u00a0106.0, p\u00a0=\u00a00.772), paper guidance confidence (U\u00a0=\u00a096.0, p\u00a0=\u00a00.438), "
    "problem-solving confidence (U\u00a0=\u00a075.0, p\u00a0=\u00a00.086), "
    "educational attainment (U\u00a0=\u00a0138.0, p\u00a0=\u00a00.245), "
    "and prior device experience (p\u00a0=\u00a00.238, permutation test). "
    "The groups were therefore considered comparable at baseline."
)

if OLD_A in text:
    text = text.replace(OLD_A, NEW_A, 1)
    print("EDIT 1 applied: §A updated.")
else:
    # Try without non-breaking spaces — the file may use regular spaces
    OLD_A2 = (
        "A total of 30 participants were enrolled and completed the study, with 15 allocated to each group. "
        "Participant ages ranged from 18 to 84 years (overall mean 34.1 \u00b1 15.6), with similar means between groups "
        "(digital 35.5 \u00b1 13.4; paper 32.8 \u00b1 17.9). Both groups reported high self-rated digital literacy (median 4/5 in each group). "
        "Table I summarises baseline characteristics. Mann\u2013Whitney U tests confirmed no significant between-group differences on any baseline measure: "
        "age (U = 83.5, p = 0.235), digital literacy (U = 92.5, p = 0.346), "
        "digital guidance confidence (U = 106.0, p = 0.772), paper guidance confidence (U = 96.0, p = 0.438), "
        "and problem-solving confidence (U = 75.0, p = 0.086). "
        "The groups were therefore considered comparable at baseline."
    )
    if OLD_A2 in text:
        NEW_A2 = NEW_A.replace('\u00a0', ' ')
        text = text.replace(OLD_A2, NEW_A2, 1)
        print("EDIT 1 applied (plain spaces): §A updated.")
    else:
        print("EDIT 1 FAILED — §A old string not found. Trying line-index method...")
        # Fall back: replace line 118 (0-indexed 117) directly
        lines = text.split('\r\n')
        print(f"  Line 118 content: {repr(lines[117][:100])}")

# -----------------------------------------------------------------------
# EDIT 2 — §I Limitations — extend first paragraph to add occupational caveat
# -----------------------------------------------------------------------

OLD_I = (
    "Participants were recruited through convenience sampling and comprised healthy adult volunteers "
    "rather than actual CPAP patients, who tend to be older adults with greater multimorbidity and potentially lower digital literacy; "
    "the high baseline digital literacy of this sample (median 4/5 in both groups) further limits generalisability "
    "to the clinical population where the intervention would be deployed."
)

NEW_I = (
    "Participants were recruited through convenience sampling and comprised healthy adult volunteers "
    "rather than actual CPAP patients, who tend to be older adults with greater multimorbidity and potentially lower digital literacy; "
    "the high baseline digital literacy of this sample (median 4/5 in both groups) further limits generalisability "
    "to the clinical population where the intervention would be deployed. "
    "Most notably, 70% of participants were employed or training in clinical science or clinical engineering, "
    "introducing a form of occupational expertise bias: familiarity with medical devices and clinical protocols "
    "may have systematically reduced the difficulty of tasks and inflated performance relative to a lay patient population. "
    "This occupational profile further constrains the extent to which findings can be extrapolated to actual CPAP users."
)

if OLD_I in text:
    text = text.replace(OLD_I, NEW_I, 1)
    print("EDIT 2 applied: §I Limitations updated.")
else:
    print("EDIT 2 FAILED — §I old string not found.")
    # Debug: search for a portion
    snippet = "Participants were recruited through convenience sampling"
    idx = text.find(snippet)
    if idx >= 0:
        print(f"  Found snippet at char {idx}: {repr(text[idx:idx+200])}")

# -----------------------------------------------------------------------
# Write back
# -----------------------------------------------------------------------

with open(filepath, 'wb') as f:
    f.write(text.encode('utf-8'))

print("File written.")
