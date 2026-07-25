import numpy as np
import matplotlib.pyplot as plt
import requests
import argparse
import json
import os
import time
import sys
from typing import List, Dict, Optional

API_BASE = os.environ.get("LATENCY_API_URL", "http://127.0.0.1:8001")
DATA_FILE = os.path.expanduser("~/.latency_monitor_cache.json")

STAGE_LABELS = [
    "Request Received",
    "Intent Classification",
    "Model Routing",
    "Memory Retrieval",
    "Context Assembly",
    "Response Generation",
    "Output Packaging",
]

STAGE_COLORS = ["#4a5568", "#e53e3e", "#3182ce", "#805ad5", "#dd6b20", "#319795", "#718096"]


def load_cache() -> List[Dict]:
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE) as f:
            return json.load(f)
    return []


def save_cache(traces: List[Dict]):
    with open(DATA_FILE, "w") as f:
        json.dump(traces, f, indent=2)


def fetch_trace(trace_id: str) -> Optional[Dict]:
    try:
        r = requests.get(f"{API_BASE}/api/traces/{trace_id}", timeout=10)
        if r.status_code == 200 and r.text != "null":
            return r.json()
    except requests.RequestException as e:
        print(f"  Request failed: {e}")
    return None


def fetch_recent_traces(limit: int = 10) -> List[Dict]:
    try:
        r = requests.get(f"{API_BASE}/api/traces", params={"limit": limit}, timeout=10)
        if r.status_code == 200:
            return r.json() or []
    except requests.RequestException as e:
        print(f"  Request failed: {e}")
    return []


def extract_stages(trace: Dict) -> Dict[str, float]:
    stages = {}
    for step in trace.get("steps", []):
        label = step.get("label", "")
        duration_ms = step.get("duration_ms") or 0
        stages[label] = duration_ms
    return stages


BAR_WIDTH = 40


def _fmt_duration(seconds: float) -> str:
    if seconds < 1:
        return f"{int(seconds * 1000)}ms"
    return f"{seconds:.1f}s"


def print_terminal_chart(stage_data: Dict[str, List[float]], trace_id: str = ""):
    totals = {s: np.sum(stage_data[s]) for s in STAGE_LABELS if stage_data[s]}
    total_sec = max(v / 1000.0 for v in totals.values()) if totals else 0

    print()
    label_width = max(len(s) for s in STAGE_LABELS)

    for stage in STAGE_LABELS:
        vals = stage_data.get(stage, [])
        avg_ms = np.mean(vals) if vals else 0
        avg_sec = avg_ms / 1000.0
        bar_chars = int((avg_ms / max(totals.values(), default=1)) * BAR_WIDTH) if totals else 0
        bar = "█" * bar_chars if avg_sec >= 1 else "░"
        print(f"  {stage:<{label_width}}  [{bar:<{BAR_WIDTH}}]  {_fmt_duration(avg_sec)}")

    print(f"\n  {'Total':<{label_width}}  {'─' * (BAR_WIDTH + 2)}  {_fmt_duration(total_sec)}")
    print()


def analyze_and_visualize(traces: List[Dict], title_suffix: str = "", terminal: bool = False):
    if not traces:
        print("No trace data available.")
        return

    stage_data = {s: [] for s in STAGE_LABELS}
    trace_ids = []

    for t in traces:
        stages = extract_stages(t)
        tid = t.get("id", "unknown")[:12]
        prompt = t.get("prompt", "")[:40]
        trace_ids.append(f"{tid}  \"{prompt}\"" if prompt else tid)
        for stage in STAGE_LABELS:
            ms = stages.get(stage, 0)
            stage_data[stage].append(ms)

    if terminal:
        print_terminal_chart(stage_data)
        return

    stage_data_sec = {s: [v / 1000.0 for v in stage_data[s]] for s in STAGE_LABELS}

    print("\n--- Pipeline Latency Breakdown ---")
    total_avg = 0
    for stage in STAGE_LABELS:
        avg = np.mean(stage_data_sec[stage]) if stage_data_sec[stage] else 0
        total_avg += avg
        label = stage.replace(" ", " ")
        print(f"  {label:<25s}  {avg:>7.2f}s")
    print(f"  {'Total Average':<25s}  {total_avg:>7.2f}s")
    print(f"  ({len(traces)} trace(s))")
    print()

    fig, ax = plt.subplots(figsize=(14, max(4, len(traces) * 0.5 + 1.5)))

    left = np.zeros(len(traces))
    for idx, stage in enumerate(STAGE_LABELS):
        durations = np.array(stage_data_sec[stage])
        bars = ax.barh(
            range(len(traces)),
            durations,
            left=left,
            label=stage,
            color=STAGE_COLORS[idx],
            edgecolor="#1a1a2e",
            height=0.6,
        )
        for bar in bars:
            w = bar.get_width()
            if w > 2.0:
                ax.text(
                    bar.get_x() + w / 2,
                    bar.get_y() + bar.get_height() / 2,
                    f"{w:.1f}s",
                    ha="center",
                    va="center",
                    color="white",
                    fontweight="bold",
                    fontsize=8,
                )
        left += durations

    ax.set_yticks(range(len(traces)))
    ax.set_yticklabels(trace_ids, fontsize=9)
    ax.set_xlabel("Duration (seconds)", fontsize=11, fontweight="bold")
    ax.set_title(f"Step-Level Latency Breakdown{title_suffix}", fontsize=13, fontweight="bold", pad=12)
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.1), ncol=4, frameon=True, fontsize=8)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="x", linestyle="--", alpha=0.3)
    fig.tight_layout()
    plt.show()


def main():
    parser = argparse.ArgumentParser(description="Agentic Step-Level Latency Monitor")
    parser.add_argument("--api-base", help="API base URL (default: $LATENCY_API_URL or http://127.0.0.1:8001)")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--trace", "-t", nargs="+", help="Fetch specific trace ID(s)")
    group.add_argument("--recent", "-r", type=int, nargs="?", const=10,
                       help="Fetch N most recent traces (default: 10)")
    group.add_argument("--watch", "-w", type=int, nargs="?", const=30,
                       help="Poll /api/traces every N seconds, accumulating data (default: 30)")
    group.add_argument("--cache", "-c", action="store_true",
                       help="Visualize from cached data only (no fetch)")
    parser.add_argument("--clear-cache", action="store_true", help="Clear cached trace data")
    parser.add_argument("--save", "-s", action="store_true",
                        help="Save fetched traces to cache")
    parser.add_argument("--terminal", "-T", action="store_true",
                        help="Render ASCII bar chart in terminal (no matplotlib window)")
    args = parser.parse_args()

    if args.api_base:
        API_BASE = args.api_base

    if args.clear_cache:
        if os.path.exists(DATA_FILE):
            os.remove(DATA_FILE)
            print("Cache cleared.")
        return

    traces = load_cache() if args.cache else []

    if args.trace:
        for tid in args.trace:
            print(f"Fetching trace {tid}...")
            t = fetch_trace(tid)
            if t:
                traces.append(t)
                print(f"  OK — {t.get('status', '?')}, "
                      f"{len(t.get('steps', []))} steps")
            else:
                print(f"  Not found or error.")

    elif args.recent is not None:
        print(f"Fetching {args.recent} recent traces...")
        fetched = fetch_recent_traces(args.recent)
        if fetched:
            seen_ids = {t.get("id") for t in traces}
            for t in fetched:
                if t.get("id") not in seen_ids:
                    traces.append(t)
            print(f"  Got {len(fetched)} traces, {len(traces)} total in session.")
        else:
            print("  No recent traces.")

    elif args.watch is not None:
        print(f"Watch mode: polling every {args.watch}s. Ctrl+C to stop and render.\n")
        try:
            while True:
                fetched = fetch_recent_traces(50)
                if fetched:
                    seen_ids = {t.get("id") for t in traces}
                    added = 0
                    for t in fetched:
                        if t.get("id") not in seen_ids:
                            traces.append(t)
                            added += 1
                    if added:
                        print(f"[{time.strftime('%H:%M:%S')}] +{added} new trace(s) "
                              f"({len(traces)} total)")
                else:
                    print(f"[{time.strftime('%H:%M:%S')}] fetch returned nothing")
                time.sleep(args.watch)
        except KeyboardInterrupt:
            print("\nWatch stopped.")
        if args.save:
            save_cache(traces)
            print(f"Saved {len(traces)} traces to cache.")
        analyze_and_visualize(traces, title_suffix=f" ({len(traces)} traces)", terminal=args.terminal)
        return

    elif not args.cache:
        parser.print_help()
        print("\nNo fetch option given. Use --cache to visualize cached data.")
        return

    if args.save:
        save_cache(traces)
        print(f"Saved {len(traces)} traces to cache.")

    analyze_and_visualize(traces, terminal=args.terminal)


if __name__ == "__main__":
    main()
