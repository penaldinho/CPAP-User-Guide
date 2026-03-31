import csv, statistics

with open(r'c:\Users\edfre\OneDrive\Documents\GitHub\CPAP-User-Guide\analysis-output\tables\task-by-participant-latest.csv', encoding='utf-8') as f:
    rows = list(csv.DictReader(f))

digital = [r for r in rows if r['allocation_group'] == 'digital']
task_ids = sorted(set(r['task_id'] for r in digital))
scenario_tasks = sorted([t for t in task_ids if 'scenario' in t.lower()])
question_tasks = sorted([t for t in task_ids if 'scenario' not in t.lower()])
all_tasks = scenario_tasks + question_tasks

print('Scenario tasks:', scenario_tasks)
print('Question tasks:', question_tasks)
print()

participants = sorted(set(r['participant_id'] for r in digital))

# Header
header = f'{"Participant":<14}'
for t in all_tasks:
    short = t.replace('scenario_card_', 'S').replace('short_form_', 'Q')
    header += f'{short:<12}'
header += '  ALL-PRIMARY'
print(header)
print('-' * len(header))

all_primary_pids = []
chat_primary_pids = []  # chat-primary on at least one (the n=6 group)

for pid in participants:
    prows = {r['task_id']: r for r in digital if r['participant_id'] == pid}
    row_str = f'{pid:<14}'
    is_all = True
    at_least_one = False
    for t in all_tasks:
        r = prows.get(t, {})
        flag = r.get('chat_primary_flag', '-')
        if flag != '1':
            is_all = False
        else:
            at_least_one = True
        short = t.replace('scenario_card_', 'S').replace('short_form_', 'Q')
        row_str += f'{flag:<12}'
    label = '  <<< ALL' if is_all else ''
    print(row_str + label)
    if is_all:
        all_primary_pids.append(pid)
    if at_least_one:
        chat_primary_pids.append(pid)

print()
print(f'Chat-primary on ALL 7 tasks: {all_primary_pids}  (n={len(all_primary_pids)})')
print(f'Chat-primary on at least 1 task: {chat_primary_pids}  (n={len(chat_primary_pids)})')

# Stats for those who were primary on ALL tasks
if all_primary_pids:
    print('\n--- Stats for participants chat-primary on EVERY task ---')
    # Aggregate scores: get participant-level summary
    with open(r'c:\Users\edfre\OneDrive\Documents\GitHub\CPAP-User-Guide\analysis-output\tables\participant-level-latest.csv', encoding='utf-8') as f:
        plevel = list(csv.DictReader(f))
    print('Participant-level columns:', list(plevel[0].keys())[:20])
    for pid in all_primary_pids:
        pdata = next((r for r in plevel if r['participant_id'] == pid), None)
        if pdata:
            print(f'\n{pid}:')
            for k, v in pdata.items():
                if v:
                    print(f'  {k}: {v}')
