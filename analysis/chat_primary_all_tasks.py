import json, collections
from collections import defaultdict

with open(r'c:\Users\edfre\OneDrive\Documents\GitHub\CPAP-User-Guide\data\telemetry-events.ndjson', encoding='utf-8') as f:
    events = [json.loads(l) for l in f if l.strip()]

tasks = sorted(set(e['task_id'] for e in events if e.get('task_id')))
print('All tasks:', tasks)

chat_counts = defaultdict(int)
page_counts = defaultdict(int)
nav_counts = defaultdict(int)

for e in events:
    pid = e.get('participant_id')
    tid = e.get('task_id')
    if not pid or not tid:
        continue
    if e['event_type'] == 'chat_submit':
        chat_counts[(pid, tid)] += 1
    if e['event_type'] == 'page_view':
        page_counts[(pid, tid)] += 1
    if e['event_type'] in ('page_view', 'nav_click'):
        nav_counts[(pid, tid)] += 1

# Chat-primary = used chat at least once AND chat submits >= page views for that task
all_participants = sorted(set(k[0] for k in chat_counts))
print(f'\nParticipants who used chat at all: {all_participants}')

print('\nPer-task chat-primary status:')
print(f'{"Participant":<14}', end='')
for t in tasks:
    print(f'{t:<12}', end='')
print()

chat_primary_all = []
for pid in all_participants:
    row = f'{pid:<14}'
    is_primary_all = True
    for tid in tasks:
        chats = chat_counts.get((pid, tid), 0)
        pages = page_counts.get((pid, tid), 0)
        primary = chats > 0 and chats >= pages
        if not primary:
            is_primary_all = False
        status = f'C{chats}/P{pages}{"*" if primary else ""}'
        row += f'{status:<12}'
    print(row + (' <-- ALL' if is_primary_all else ''))
    if is_primary_all:
        chat_primary_all.append(pid)

print(f'\nParticipants chat-primary on EVERY task: {chat_primary_all} (n={len(chat_primary_all)})')

# Now load task performance data to get their stats
with open(r'c:\Users\edfre\OneDrive\Documents\GitHub\CPAP-User-Guide\data\telemetry-events.ndjson', encoding='utf-8') as f:
    raw = f.read()

# Check participant-level data file
import os
data_dir = r'c:\Users\edfre\OneDrive\Documents\GitHub\CPAP-User-Guide\data'
for fn in os.listdir(data_dir):
    print('Data file:', fn)
