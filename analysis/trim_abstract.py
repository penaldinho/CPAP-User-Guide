import re

path = r"c:\Users\edfre\OneDrive\Documents\GitHub\CPAP-User-Guide\Write Up\MSc-Report-Draft.md"

with open(path, 'rb') as f:
    raw = f.read()

text = raw.decode('utf-8')

# ── New abstract sections ─────────────────────────────────────────────────────

new_objective = (
    "Objective: Home-use medical devices increasingly require patients to self-manage "
    "setup, use, and troubleshooting with limited clinical supervision. This study "
    "evaluated whether a digital interactive CPAP guide improves users\u2019 task "
    "performance and safety compared with a paper manufacturer manual."
)

new_methods = (
    "Methods: A parallel-group, simulated-use human factors study was conducted using "
    "a real CPAP device in a controlled home-like environment. Thirty participants were "
    "randomised to a paper manual group or a digital guide group. The digital guide "
    "delivered equivalent instructional content enhanced with search, structured "
    "navigation, hyperlinking, and AI chatbot support. Outcomes included task "
    "completion, error count, time on task, information-retrieval accuracy and time, "
    "subjective usability, confidence, and workload."
)

new_results = (
    "Results: The digital group committed fewer errors (\u03b4\u2009=\u2009\u22120.45, "
    "p\u2009=\u20090.035) and achieved a markedly higher full-completion rate on the "
    "initial setup task (93% vs 40%; OR\u2009=\u200921.0, p\u2009=\u20090.005). All "
    "four usability items significantly favoured the digital group "
    "(\u03b4\u2009=\u20090.43\u20130.44). Post-trial troubleshooting confidence was "
    "the largest effect (\u03b4\u2009=\u20090.60, p\u2009=\u20090.003) and the only "
    "outcome to survive Benjamini\u2013Hochberg correction (adjusted "
    "p\u2009=\u20090.045). Information-retrieval time was consistently shorter in the "
    "digital group (\u03b4\u2009=\u2009\u22120.37, p\u2009=\u20090.059). Total "
    "scenario time did not differ."
)

new_conclusion = (
    "Conclusion: The digital platform produced consistent advantages in task quality, "
    "usability, and confidence, with reduced frustration and no cognitive workload "
    "increase. Findings are preliminary but provide early empirical support for digital "
    "IFU platforms incorporating AI-assisted retrieval as a complement to or replacement "
    "for traditional paper manuals for home-use medical device training."
)

# ── Locate and replace each abstract line ────────────────────────────────────

def replace_line(text, prefix, new_line):
    """Replace the first line that starts with `prefix` with `new_line`."""
    m = re.search(re.escape(prefix) + r'[^\r\n]+', text)
    if not m:
        raise ValueError(f"Could not find line starting with: {prefix!r}")
    return text[:m.start()] + new_line + text[m.end():]

text = replace_line(text, "Objective:", new_objective)
text = replace_line(text, "Methods: A comparative", new_methods)
text = replace_line(text, "Results: Thirty participants were enrolled", new_results)
text = replace_line(text, "Conclusion: The digital platform produced a consistent", new_conclusion)

# Remove Significance line (and its trailing CRLF or LF)
text = re.sub(r'Significance:[^\r\n]+\r?\n', '', text)

# ── Word count check ─────────────────────────────────────────────────────────

abstract_start = text.find("Abstract\r\n")
if abstract_start == -1:
    abstract_start = text.find("Abstract\n")

index_terms_start = text.find("Index Terms")

abstract_body = text[abstract_start:index_terms_start]
word_count = len(abstract_body.split())
print(f"Abstract section word count (incl. 'Abstract' label): {word_count}")
# Subtract 1 for the "Abstract" heading word itself
print(f"Abstract body word count: {word_count - 1}")

# ── Write back ───────────────────────────────────────────────────────────────

with open(path, 'wb') as f:
    f.write(text.encode('utf-8'))

print("File written successfully.")
