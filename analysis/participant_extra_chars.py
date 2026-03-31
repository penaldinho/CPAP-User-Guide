"""Compute education, occupation, and device experience breakdowns by group."""

# Correct group allocations
digital = {'P01','P04','P05','P07','P10','P12','P13','P16','P18','P19','P21','P23','P26','P28','P30'}
physical = {'P02','P03','P06','P08','P09','P11','P14','P15','P17','P20','P22','P24','P25','P27','P29'}

# Data from pre-trial questionnaire SQL export
records = [
    ('P01','postgraduate_degree','Engineer',['none']),
    ('P02','secondary_or_below','Retired Plasterer',['blood_pressure_monitor','blood_glucose_monitor','inhaler_nebuliser']),
    ('P03','university_degree','',['blood_pressure_monitor']),
    ('P04','university_degree','teacher',['blood_glucose_monitor','sleep_fitness_tracker']),
    ('P05','postgraduate_degree','Salesman',['none']),
    ('P06','secondary_or_below','',['none']),
    ('P07','postgraduate_degree','Senior Clinical Engineer',['blood_pressure_monitor','inhaler_nebuliser','sleep_fitness_tracker']),
    ('P08','postgraduate_degree','Clinical Scientist/Clinical Engineer',['blood_pressure_monitor']),
    ('P09','university_degree','Trainee Clinical Scientist',['none']),
    ('P10','postgraduate_degree','Trainee Clinical Scientist',['sleep_fitness_tracker']),
    ('P11','postgraduate_degree','Clinical Scientist',['blood_pressure_monitor','sleep_fitness_tracker']),
    ('P12','postgraduate_degree','clinical scientist',['blood_pressure_monitor','blood_glucose_monitor']),
    ('P13','postgraduate_degree','Clinical Scientist',['blood_pressure_monitor','blood_glucose_monitor','inhaler_nebuliser','sleep_fitness_tracker']),
    ('P14','postgraduate_degree','Clinical Engineer',['sleep_fitness_tracker']),
    ('P15','postgraduate_degree','Clinical Engineer',['inhaler_nebuliser']),
    ('P16','postgraduate_degree','Clinical Engineer',['blood_pressure_monitor','blood_glucose_monitor','sleep_fitness_tracker','other']),
    ('P17','postgraduate_degree','Clinical Scientist',['none']),
    ('P18','postgraduate_degree','',['sleep_fitness_tracker']),
    ('P19','postgraduate_degree','Clinical Scientist',['none']),
    ('P20','university_degree','',['none']),
    ('P21','university_degree','Trainee Clinical Engineer',['blood_pressure_monitor']),
    ('P22','university_degree','Trainee clinical scientist',['none']),
    ('P23','postgraduate_degree','Trainee Clinical Scientist',['blood_pressure_monitor','sleep_fitness_tracker']),
    ('P24','postgraduate_degree','NHS manager',['blood_pressure_monitor','blood_glucose_monitor','sleep_fitness_tracker']),
    ('P25','postgraduate_degree','Trainee clinical scientist',['none']),
    ('P26','university_degree','',['blood_pressure_monitor','inhaler_nebuliser']),
    ('P27','postgraduate_degree','Specialist Medical Device Management Officer',['none']),
    ('P28','postgraduate_degree','clinical engineer',['sleep_fitness_tracker']),
    ('P29','postgraduate_degree','',['blood_pressure_monitor','sleep_fitness_tracker']),
    ('P30','postgraduate_degree','Clinical Engineer',['blood_glucose_monitor','sleep_fitness_tracker']),
]

def grp(pid): return 'digital' if pid in digital else 'physical'

from collections import Counter

# --- EDUCATION ---
edu_d = Counter()
edu_p = Counter()
for pid, edu, occ, dev in records:
    if grp(pid) == 'digital': edu_d[edu] += 1
    else: edu_p[edu] += 1

print("=== EDUCATION ===")
for level, label in [('postgraduate_degree','Postgraduate degree'), ('university_degree','University degree'), ('secondary_or_below','Secondary or below')]:
    d, p = edu_d[level], edu_p[level]
    t = d + p
    print(f"  {label:<28} Digital: {d}/15 ({d/15*100:.0f}%)   Physical: {p}/15 ({p/15*100:.0f}%)   Total: {t}/30 ({t/30*100:.0f}%)")

# --- HOME DEVICE EXPERIENCE ---
print("\n=== HOME DEVICE EXPERIENCE ===")
has_d = [pid for pid,_,_,dev in records if grp(pid)=='digital' and dev != ['none']]
has_p = [pid for pid,_,_,dev in records if grp(pid)=='physical' and dev != ['none']]
none_d = [pid for pid,_,_,dev in records if grp(pid)=='digital' and dev == ['none']]
none_p = [pid for pid,_,_,dev in records if grp(pid)=='physical' and dev == ['none']]
print(f"  With prior device experience:  Digital {len(has_d)}/15 ({len(has_d)/15*100:.0f}%)   Physical {len(has_p)}/15 ({len(has_p)/15*100:.0f}%)   Total {len(has_d)+len(has_p)}/30 ({(len(has_d)+len(has_p))/30*100:.0f}%)")
print(f"  No prior device experience:    Digital {len(none_d)}/15 ({len(none_d)/15*100:.0f}%)   Physical {len(none_p)}/15 ({len(none_p)/15*100:.0f}%)   Total {len(none_d)+len(none_p)}/30 ({(len(none_d)+len(none_p))/30*100:.0f}%)")

print("\n  Device types (any participant):")
all_devs = []
for _,_,_,dev in records:
    all_devs.extend([d for d in dev if d != 'none'])
for d, c in sorted(Counter(all_devs).items(), key=lambda x: -x[1]):
    print(f"    {d}: n={c}")

# --- OCCUPATION ---
print("\n=== OCCUPATION ===")
clinical_kw = ['clinical','scientist','engineer','science','medical device','nhs']

cats = {'clinical_science_engineering_d': [], 'clinical_science_engineering_p': [],
        'other_d': [], 'other_p': [], 'not_stated_d': [], 'not_stated_p': []}

for pid, edu, occ, dev in records:
    g = grp(pid)
    if not occ.strip():
        cats[f'not_stated_{g[0]}'].append(pid)
    elif any(k in occ.lower() for k in clinical_kw):
        cats[f'clinical_science_engineering_{g[0]}'].append(pid)
    else:
        cats[f'other_{g[0]}'].append(pid)

cse_d = len(cats['clinical_science_engineering_d'])
cse_p = len(cats['clinical_science_engineering_p'])
oth_d = len(cats['other_d'])
oth_p = len(cats['other_p'])
ns_d  = len(cats['not_stated_d'])
ns_p  = len(cats['not_stated_p'])

print(f"  Clinical science/engineering:  Digital {cse_d}/15 ({cse_d/15*100:.0f}%)   Physical {cse_p}/15 ({cse_p/15*100:.0f}%)   Total {cse_d+cse_p}/30 ({(cse_d+cse_p)/30*100:.0f}%)")
print(f"    IDs (digital): {sorted(cats['clinical_science_engineering_d'])}")
print(f"    IDs (physical): {sorted(cats['clinical_science_engineering_p'])}")
print(f"  Other occupations:             Digital {oth_d}/15   Physical {oth_p}/15   Total {oth_d+oth_p}/30")
print(f"    other_d: {sorted(cats['other_d'])}  other_p: {sorted(cats['other_p'])}")
print(f"  Not stated:                    Digital {ns_d}/15   Physical {ns_p}/15   Total {ns_d+ns_p}/30")
print(f"    not_stated_d: {sorted(cats['not_stated_d'])}  not_stated_p: {sorted(cats['not_stated_p'])}")

# MWU test on education (ordinal encoding) for baseline equivalence
print("\n=== BASELINE EQUIVALENCE (permutation test) ===")
import random
random.seed(42)
edu_ord = {'secondary_or_below': 1, 'university_degree': 2, 'postgraduate_degree': 3}

all_edu = [edu_ord[edu] for pid,edu,_,__ in records]
dig_edu = [edu_ord[edu] for pid,edu,_,__ in records if grp(pid)=='digital']
phy_edu = [edu_ord[edu] for pid,edu,_,__ in records if grp(pid)=='physical']

# Observed U statistic
def mwu_u(a, b):
    u = sum(1 for x in a for y in b if x > y) + 0.5 * sum(1 for x in a for y in b if x == y)
    return u

obs_u = mwu_u(dig_edu, phy_edu)
n = len(all_edu)
count = 0
N_PERM = 5000
for _ in range(N_PERM):
    shuffled = all_edu[:]
    random.shuffle(shuffled)
    d, p_ = shuffled[:15], shuffled[15:]
    u_s = mwu_u(d, p_)
    if abs(u_s - 15*15/2) >= abs(obs_u - 15*15/2):
        count += 1
p_edu = count / N_PERM
print(f"  Education: U={obs_u:.1f}, permutation p={p_edu:.3f}")

# Device experience (binary): permutation on proportion difference
obs_diff = len(has_d)/15 - len(has_p)/15
all_dev_bin = [1]*len(has_d) + [0]*len(none_d) + [1]*len(has_p) + [0]*len(none_p)
count2 = 0
for _ in range(N_PERM):
    shuffled = all_dev_bin[:]
    random.shuffle(shuffled)
    d2, p2 = shuffled[:15], shuffled[15:]
    diff = sum(d2)/15 - sum(p2)/15
    if abs(diff) >= abs(obs_diff):
        count2 += 1
p_dev = count2 / N_PERM
print(f"  Device experience: Digital {len(has_d)}/15 vs Physical {len(has_p)}/15, permutation p={p_dev:.3f}")
