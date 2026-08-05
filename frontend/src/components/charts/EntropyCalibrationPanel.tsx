"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ResearchPopover from "../ResearchPopover";

interface EntropyInfo {
  mean_entropy: number | null;
}

interface CalTrace {
  id: string;
  model_used?: string | null;
  token_entropy?: EntropyInfo | null;
  ddc?: {
    prompt?: { margin?: number; score?: number } | null;
    response?: { margin?: number; score?: number } | null;
  } | null;
  lcc?: {
    prompt?: { margin?: number; score?: number } | null;
  } | null;
  steps?: { label: string; metadata: Record<string, unknown> }[];
}

interface Props {
  traces: CalTrace[];
}

interface Metric {
  key: string;
  label: string;
  pick: (t: CalTrace) => number | null;
  direction: "lower-better" | "higher-better";
  color: string;
}

const METRICS: Metric[] = [
  {
    key: "ddc_prompt_margin",
    label: "DDC prompt margin",
    pick: (t) => t.ddc?.prompt?.margin ?? null,
    direction: "lower-better",
    color: "#60a5fa",
  },
  {
    key: "ddc_response_margin",
    label: "DDC response margin",
    pick: (t) => t.ddc?.response?.margin ?? null,
    direction: "lower-better",
    color: "#a78bfa",
  },
  {
    key: "lcc_prompt_margin",
    label: "LCC prompt margin",
    pick: (t) => t.lcc?.prompt?.margin ?? null,
    direction: "lower-better",
    color: "#f472b6",
  },
  {
    key: "intent_confidence",
    label: "Intent confidence",
    pick: (t) => {
      for (const s of t.steps || []) {
        if (s.label === "Intent Classification") {
          const probs = s.metadata?.intent_probs;
          if (Array.isArray(probs) && probs.length > 0 && probs[0]) {
            const c = (probs[0] as { confidence?: number }).confidence;
            if (typeof c === "number") return c;
          }
        }
      }
      return null;
    },
    direction: "higher-better",
    color: "#34d399",
  },
];

const MIN_N = 6;
const fmt = (v: number | null, digits = 2) => (v == null ? "—" : v.toFixed(digits));

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const xm = xs.reduce((a, b) => a + b, 0) / n;
  const ym = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - xm, b = ys[i] - ym;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy) || 1;
  return num / den;
}

export default function EntropyCalibrationPanel({ traces }: Props) {
  const [hovered, setHovered] = useState<{ metric: string; trace: CalTrace; entropy: number; value: number; x: number; y: number } | null>(null);
  const hoverTimer = useRef<number | null>(null);

  const rows = useMemo(
    () =>
      METRICS.map((m) => {
        const pts: { t: CalTrace; entropy: number; value: number }[] = [];
        for (const t of traces) {
          const e = t.token_entropy?.mean_entropy;
          const v = m.pick(t);
          if (e == null || v == null) continue;
          pts.push({ t, entropy: e, value: v });
        }
        const xs = pts.map((p) => p.entropy);
        const ys = pts.map((p) => p.value);
        const r = pearson(xs, ys);
        return { metric: m, pts, r, n: pts.length };
      }),
    [traces]
  );

  const total = rows.reduce((s, r) => s + r.n, 0);
  const usable = rows.filter((r) => r.n >= MIN_N).length;
  const maxEntropy = Math.max(0.5, ...rows.flatMap((r) => r.pts.map((p) => p.entropy)));
  const maxValue = Math.max(0.5, ...rows.flatMap((r) => r.pts.map((p) => p.value)));

  const verdict = useMemo((): { tone: string; text: string } => {
    if (total === 0) {
      return { tone: "text-zinc-500", text: "No traces yet with both token entropy and classifier margin/confidence — entropy-capable traces will populate this panel." };
    }
    if (usable === 0) {
      return { tone: "text-amber-400/90", text: `Small sample (n=${total} total across metrics) — correlations here are anecdotal, not findings. Need ≥${MIN_N} paired points per metric for the verdict to self-upgrade.` };
    }
    // The calibration hypothesis: uncertain generations (high entropy)
    // should coincide with low classification margins (low margin/high confidence
    // separated from high-entropy points).
    const strongest = rows
      .filter((r) => r.n >= MIN_N)
      .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))[0];
    if (!strongest) return { tone: "text-amber-400/90", text: "No metric reached the minimum sample size." };
    const dir = strongest.metric.direction === "lower-better" ? -1 : 1;
    const expected = dir * strongest.r;
    const absR = Math.abs(strongest.r);
    if (absR < 0.2) {
      return { tone: "text-zinc-400", text: `Weakest correlation is ${strongest.metric.label} (r=${fmt(strongest.r)}, n=${strongest.n}) — classification confidence and response uncertainty look independent so far.` };
    }
    if (expected > 0) {
      return { tone: "text-teal-300/90", text: `Uncertain generations align with low classifier confidence: ${strongest.metric.label} r=${fmt(strongest.r)} (n=${strongest.n}). High-entropy responses coincide with low-margin classifications.` };
    }
    return { tone: "text-amber-400/90", text: `Inverse relationship: ${strongest.metric.label} r=${fmt(strongest.r)} (n=${strongest.n}) — higher uncertainty correlates with HIGHER classifier confidence. Worth inspecting which categories behave this way.` };
  }, [rows, total, usable]);

  const exportCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const header = ["id", "model", "mean_entropy", ...METRICS.map((m) => m.label)];
    const body = traces.map((t) => [
      esc(t.id),
      esc(t.model_used || "unknown"),
      fmt(t.token_entropy?.mean_entropy ?? null, 4),
      ...METRICS.map((m) => fmt(m.pick(t), 4)),
    ]);
    const blob = new Blob(["\ufeff" + [header.join(","), ...body.map((r) => r.join(","))].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "entropy-confidence-calibration.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onEnter = (m: string, p: { t: CalTrace; entropy: number; value: number }, e: React.MouseEvent) => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      setHovered({ metric: m, trace: p.t, entropy: p.entropy, value: p.value, x: e.clientX, y: e.clientY });
    }, 80);
  };
  const onLeave = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    setHovered(null);
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-mono tracking-wider text-zinc-400">
            Does response uncertainty track classifier confidence?
          </span>
          <span className="text-[9px] font-mono text-zinc-600 max-w-[340px] leading-relaxed">
            Mean token entropy of each response plotted against its DDC/LCC classification margins and intent
            confidence. Hypothesis: uncertain generations (high entropy) should coincide with low-margin,
            low-confidence classifications. Pearson r per metric; verdict self-upgrades past n={MIN_N}.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ResearchPopover refKey="calibration" align="right" />
          <button
            onClick={exportCsv}
            disabled={total === 0}
            className="text-zinc-500 hover:text-teal-mystic/70 transition-colors shrink-0 disabled:opacity-40"
            title="Export CSV"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        </div>
      </div>

      {total === 0 ? (
        <div className="flex flex-col gap-2 py-6">
          <span className="text-[10px] font-mono text-zinc-500">No paired entropy + confidence data yet.</span>
          <span className="text-[9px] font-mono text-zinc-600 max-w-[380px] leading-relaxed">
            Entropy is captured on OpenAI-protocol workers (e.g. gpt-oss:20B). New traces carrying both
            <code className="text-zinc-500"> token_entropy</code> and DDC/LCC margins will populate this panel.
          </span>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {rows.map(({ metric, pts, r, n }) => {
              const W = 180, H = 56;
              const px = (v: number) => (maxEntropy > 0 ? (v / maxEntropy) * W : 0);
              const py = (v: number) => H - (maxValue > 0 ? (v / maxValue) * H : 0);
              return (
                <div key={metric.key} className="flex items-center gap-3">
                  <span className="text-[9px] font-mono text-zinc-500 w-[110px] shrink-0 truncate" title={metric.label}>
                    {metric.label}
                  </span>
                  <svg width={W} height={H} className="shrink-0 rounded bg-white/[0.02] border border-white/[0.04]">
                    {pts.map((p, i) => (
                      <circle
                        key={i}
                        cx={px(p.entropy)}
                        cy={py(p.value)}
                        r={2.5}
                        fill={metric.color}
                        opacity={0.85}
                        className="cursor-help"
                        onMouseEnter={(e) => onEnter(metric.key, p, e)}
                        onMouseLeave={onLeave}
                      />
                    ))}
                  </svg>
                  <div className="flex flex-col w-[52px] shrink-0">
                    <span className={`text-[10px] font-mono ${Math.abs(r) >= 0.2 && n >= MIN_N ? "text-teal-300" : "text-zinc-500"}`}>
                      r {fmt(r)}
                    </span>
                    <span className="text-[8px] font-mono text-zinc-600">n={n}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <p className={`text-[10px] font-mono leading-relaxed ${verdict.tone}`}>{verdict.text}</p>
        </>
      )}

      {hovered && createPortal(
        <div
          className="pointer-events-none fixed z-[100] rounded-lg border border-white/10 bg-[#0b1b22]/95 px-3 py-2 shadow-xl"
          style={{ left: hovered.x + 14, top: hovered.y + 14 }}
        >
          <div className="text-[10px] font-mono text-zinc-200 mb-1">{hovered.trace.id.slice(0, 8)}</div>
          <div className="flex flex-col gap-0.5 text-[9px] font-mono text-zinc-400">
            <span>entropy: {fmt(hovered.entropy, 4)} bits</span>
            <span>{hovered.metric}: {fmt(hovered.value, 4)}</span>
            <span className="text-zinc-600">{hovered.trace.model_used || "unknown"}</span>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
