from __future__ import annotations

import csv
import json
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
TABLES_DIR = ROOT / "analysis-output" / "tables"
FIGURES_DIR = ROOT / "analysis-output" / "figures"

PARTICIPANT_LEVEL = TABLES_DIR / "participant-level-latest.csv"

PREFERENCE_ORDER = [
    "online_website",
    "printed_instructions",
    "mix_of_formats",
    "pdf_document",
    "no_preference",
]

PREFERENCE_LABELS = {
    "online_website": "Online website",
    "printed_instructions": "Printed instructions",
    "mix_of_formats": "Mix of formats",
    "pdf_document": "PDF document",
    "no_preference": "No preference",
}

PREFERENCE_COLORS = {
    "online_website": "rgba(37, 99, 235, 0.82)",
    "printed_instructions": "rgba(217, 119, 6, 0.82)",
    "mix_of_formats": "rgba(5, 150, 105, 0.82)",
    "pdf_document": "rgba(124, 58, 237, 0.82)",
    "no_preference": "rgba(100, 116, 139, 0.82)",
}


def build_html(title: str, subtitle: str, payload: dict) -> str:
    template = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>__TITLE__</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f8fafc;
      --panel: #ffffff;
      --ink: #0f172a;
      --muted: #475569;
      --border: #cbd5e1;
      --grid: #e2e8f0;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", "Helvetica Neue", sans-serif;
      background: linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);
      color: var(--ink);
    }
    .page {
      max-width: 100%;
      padding: 24px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 18px;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
      overflow: hidden;
    }
    .header {
      padding: 20px 24px 12px;
      border-bottom: 1px solid var(--grid);
    }
    .title {
      margin: 0;
      font-size: 1.35rem;
      line-height: 1.2;
    }
    .subtitle {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 0.95rem;
    }
    .legend {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      margin-top: 12px;
      color: var(--muted);
      font-size: 0.9rem;
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .legend-swatch {
      width: 12px;
      height: 12px;
      border-radius: 999px;
      border: 1px solid rgba(15, 23, 42, 0.16);
    }
    .chart-wrap {
      padding: 8px 0 20px;
      overflow-x: auto;
    }
    svg {
      display: block;
      background: transparent;
    }
    .step-label {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
      fill: #334155;
    }
    .step-guide {
      stroke: var(--grid);
      stroke-dasharray: 3 5;
    }
    .node rect {
      stroke: rgba(15, 23, 42, 0.28);
      stroke-width: 1;
      rx: 4;
    }
    .node text {
      font-size: 12px;
      fill: #0f172a;
      dominant-baseline: middle;
    }
    .link {
      fill: none;
      stroke-opacity: 0.42;
      mix-blend-mode: multiply;
      stroke-linecap: butt;
    }
    .link:hover {
      stroke-opacity: 0.74;
    }
    .tooltip {
      position: fixed;
      pointer-events: none;
      opacity: 0;
      background: rgba(15, 23, 42, 0.95);
      color: white;
      padding: 10px 12px;
      border-radius: 10px;
      font-size: 12px;
      line-height: 1.4;
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.22);
      max-width: 320px;
      transition: opacity 120ms ease;
      z-index: 20;
    }
  </style>
</head>
<body>
  <div class="page">
    <section class="card">
      <header class="header">
        <h1 class="title">__TITLE__</h1>
        <p class="subtitle">__SUBTITLE__</p>
        <div class="legend">
          __LEGEND__
        </div>
      </header>
      <div class="chart-wrap" id="chart"></div>
    </section>
  </div>
  <div class="tooltip" id="tooltip"></div>
  <script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/d3-sankey@0.12.3/dist/d3-sankey.min.js"></script>
  <script>
    const data = __DATA__;
    const margin = { top: 58, right: 220, bottom: 24, left: 220 };
    const width = data.width;
    const height = data.height;

    const container = d3.select('#chart');
    const svg = container.append('svg')
      .attr('width', width)
      .attr('height', height);

    const tooltip = d3.select('#tooltip');
    const graph = {
      nodes: data.nodes.map(node => ({ ...node })),
      links: data.links.map(link => ({ ...link }))
    };

    const sankey = d3.sankey()
      .nodeId(node => node.id)
      .nodeAlign(d3.sankeyLeft)
      .nodeWidth(16)
      .nodePadding(18)
      .nodeSort((left, right) => left.sortIndex - right.sortIndex)
      .extent([[margin.left, margin.top], [width - margin.right, height - margin.bottom]]);

    sankey(graph);

    svg.append('g')
      .selectAll('line')
      .data(data.steps)
      .join('line')
      .attr('class', 'step-guide')
      .attr('x1', step => step.x)
      .attr('x2', step => step.x)
      .attr('y1', margin.top - 20)
      .attr('y2', height - margin.bottom + 4);

    svg.append('g')
      .selectAll('text')
      .data(data.steps)
      .join('text')
      .attr('class', 'step-label')
      .attr('x', step => step.x)
      .attr('y', margin.top - 30)
      .attr('text-anchor', 'middle')
      .text(step => step.label);

    const linkGroup = svg.append('g')
      .attr('fill', 'none')
      .selectAll('path')
      .data(graph.links)
      .join('path')
      .attr('class', 'link')
      .attr('d', d3.sankeyLinkHorizontal())
      .attr('stroke', link => link.color)
      .attr('stroke-width', link => Math.max(1, link.width))
      .on('mousemove', (event, link) => {
        tooltip
          .style('opacity', 1)
          .style('left', `${event.clientX + 12}px`)
          .style('top', `${event.clientY + 12}px`)
          .html(`<strong>${link.sourceLabel}</strong> → <strong>${link.targetLabel}</strong><br>Participants: ${link.count}`);
      })
      .on('mouseleave', () => tooltip.style('opacity', 0));

    const nodeGroup = svg.append('g')
      .selectAll('g')
      .data(graph.nodes)
      .join('g')
      .attr('class', 'node');

    nodeGroup.append('rect')
      .attr('x', node => node.x0)
      .attr('y', node => node.y0)
      .attr('height', node => Math.max(8, node.y1 - node.y0))
      .attr('width', node => node.x1 - node.x0)
      .attr('fill', node => node.color)
      .on('mousemove', (event, node) => {
        tooltip
          .style('opacity', 1)
          .style('left', `${event.clientX + 12}px`)
          .style('top', `${event.clientY + 12}px`)
          .html(`<strong>${node.label}</strong><br>${node.stage}<br>Participants: ${node.value}`);
      })
      .on('mouseleave', () => tooltip.style('opacity', 0));

    nodeGroup.append('text')
      .attr('x', node => node.x0 < width / 2 ? node.x1 + 8 : node.x0 - 8)
      .attr('y', node => (node.y0 + node.y1) / 2)
      .attr('text-anchor', node => node.x0 < width / 2 ? 'start' : 'end')
      .text(node => `${node.label} (${node.value})`);
  </script>
</body>
</html>
"""
    legend = "".join(
        f'<span class="legend-item"><span class="legend-swatch" style="background: {PREFERENCE_COLORS[key]}"></span>{PREFERENCE_LABELS[key]}</span>'
        for key in PREFERENCE_ORDER
    )
    return (
        template.replace("__TITLE__", title)
        .replace("__SUBTITLE__", subtitle)
        .replace("__LEGEND__", legend)
        .replace("__DATA__", json.dumps(payload))
    )


def build_group_payload(group: str, rows: list[dict[str, str]]) -> dict:
    counts = Counter((row["pre_format_preference"], row["post_format_preference"]) for row in rows)

    pre_totals = {
        key: sum(counts[(key, post)] for post in PREFERENCE_ORDER)
        for key in PREFERENCE_ORDER
    }
    post_totals = {
        key: sum(counts[(pre, key)] for pre in PREFERENCE_ORDER)
        for key in PREFERENCE_ORDER
    }

    nodes = []
    for index, key in enumerate(PREFERENCE_ORDER):
        pre_value = pre_totals[key]
        post_value = post_totals[key]
        if pre_value > 0:
            nodes.append(
                {
                    "id": f"pre:{key}",
                    "label": PREFERENCE_LABELS[key],
                    "stage": "Pre-trial",
                    "sortIndex": index,
                    "color": PREFERENCE_COLORS[key],
                    "value": pre_value,
                }
            )
        if post_value > 0:
            nodes.append(
                {
                    "id": f"post:{key}",
                    "label": PREFERENCE_LABELS[key],
                    "stage": "Post-trial",
                    "sortIndex": index,
                    "color": PREFERENCE_COLORS[key],
                    "value": post_value,
                }
            )

    links = []
    for source in PREFERENCE_ORDER:
        for target in PREFERENCE_ORDER:
            count = counts[(source, target)]
            if count <= 0:
                continue
            links.append(
                {
                    "source": f"pre:{source}",
                    "target": f"post:{target}",
                    "value": count,
                    "count": count,
                    "color": PREFERENCE_COLORS[target],
                    "sourceLabel": PREFERENCE_LABELS[source],
                    "targetLabel": PREFERENCE_LABELS[target],
                }
            )

    return {
        "width": 1240,
        "height": 620,
        "steps": [
            {"label": "Pre-trial preference", "x": 220},
            {"label": "Post-trial preference", "x": 1020},
        ],
        "nodes": nodes,
        "links": links,
    }


def main() -> None:
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    rows = list(csv.DictReader(PARTICIPANT_LEVEL.open(encoding="utf-8")))

    for group, label in (("digital", "Digital group"), ("physical", "Physical group")):
        subset = [row for row in rows if row["allocation_group"] == group]
        payload = build_group_payload(group, subset)
        changed = sum(1 for row in subset if row["pre_format_preference"] != row["post_format_preference"])
        subtitle = (
            f"Format preference shifts for the {label.lower()} (n = {len(subset)}). "
            f"Hover flows for exact participant counts. {changed} of {len(subset)} participants changed preference."
        )
        html = build_html(f"{label} format-preference Sankey", subtitle, payload)
        output_path = FIGURES_DIR / f"starter-{group}-format-preference-sankey-latest.html"
        output_path.write_text(html, encoding="utf-8")
        print(output_path)


if __name__ == "__main__":
    main()