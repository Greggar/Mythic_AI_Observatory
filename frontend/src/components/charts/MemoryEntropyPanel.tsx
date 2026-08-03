"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface EntropyInfo {
  mean_entropy: number | null;
  p95_entropy: number | null;
  mean_surprisal: number | null;
  high_entropy_count: number;
  token_count: number;
}

interface Chunk {
  used?: boolean;
  relevance?: number;
  content?: string;
  trace_id?: string;
}

interface EntropyTrace {
  id: string;
  model_used?: string | null;
  token_entropy?: EntropyInfo | null;
  steps?: { label: string; metadata: Record<string, unknown> }[];
}

interface Props {
  traces: EntropyTrace[];
}

type GroupKey = "used" | "discarded" | "none";

interface EntropyGroup {
  key: GroupKey;
  label: string;
  color: string;
  count: number;
  meanEntropy: number | null;
  p95Entropy: number | null;
  meanSurprisal: number | null;
  highTokens: number;
  totalTokens: number;
  models: Map<string, number>;
}

const GROUP_META: Record<GroupKey, { label: string; color: string }> = {
  used: { label: "Used chunks", color: "#2dd4bf" },
  discarded: { label: "Chunks discarded", color: "#fbbf24" },
  none: { label: "No memory retrieved", color: "#71717a" },
};

function classifyTrace(t: EntropyTrace): GroupKey {
  let chunks: Chunk[] = [];
  for (const s of t.steps || []) {
    const raw = s.metadata?.retrieved_chunks;
    if (Array.isArray(raw)) chunks = raw as Chunk[];
  }
  if (chunks.length === 0) return "none";
  if (chunks.some((c) => c.used)) return "used";
  return "discarded";
}

function groupStats(traces: EntropyTrace[], key: GroupKey): EntropyGroup {
  const subset = traces.filter((t) => classifyTrace(t) === key);
  const withEnt = subset.filter((t) => t.token_entropy?.mean_entropy != null);
  const models = new Map<string, number>();
  for (const t of withEnt) {
    const m = t.model_used || "unknown";
    models.set(m, (models.get(m) || 0) + 1);
  }
  const mean = (sel: (e: EntropyInfo) => number | null) => {
    const vals = withEnt.map((t) => sel(t.token_entropy as EntropyInfo)).filter((v): v is number => v != null);
    if (vals.length === 0) return null;
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  };
  let high = 0;
  let total = 0;
  for (const t of withEnt) {
    high += t.token_entropy!.high_entropy_count || 0;
    total += t.token_entropy!.token_count || 0;
  }
  return {
    key,
    label: GROUP_META[key].label,
    color: GROUP_META[key].color,
    count: withEnt.length,
    meanEntropy: mean((e) => e.mean_entropy),
    p95Entropy: mean((e) => e.p95_entropy),
    meanSurprisal: mean((e) => e.mean_surprisal),
    highTokens: high,
    totalTokens: total,
    models,
  };
}

const fmt = (v: number | null, digits = 2) => (v == null ? "—" : v.toFixed(digits));
const ANECDOTAL = 10;

export default function MemoryEntropyPanel({ traces }: Props) {
  const [hovered, setHovered] = useState<GroupKey | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const hoverTimer = useRef<number | null>(null);

  const groups = useMemo(
    () => (["used", "discarded", "none"] as GroupKey[]).map((k) => groupStats(traces, k)),
    [traces]
  );

  const totalWithEntropy = groups.reduce((s, g) => s + g.count, 0);
  const used = groups.find((g) => g.key === "used")!;
  const discarded = groups.find((g) => g.key === "discarded")!;
  const delta = used.meanEntropy != null && discarded.meanEntropy != null ? used.meanEntropy - discarded.meanEntropy : null;

  const maxEntropy = Math.max(0.5, ...groups.map((g) => g.meanEntropy ?? 0));

  const verdict = useMemo((): { tone: string; text: string } => {
    const usable = used.count >= 3 && discarded.count >= 3;
    const anecdotal = totalWithEntropy < ANECDOTAL;
    let text: string;
    if (delta == null) {
      text = "No comparison possible yet — need traces in at least two chunk-usage groups with token-entropy data.";
    } else if (Math.abs(delta) < 0.1) {
      text = `No meaningful difference (Δ ${fmt(delta)} bits) — retrieved context neither grounds nor distracts so far.`;
    } else if (delta < 0) {
      text = `Memory appears to ground responses — traces that incorporated retrieved chunks wrote with ${fmt(Math.abs(delta))} bits lower mean token uncertainty.`;
    } else {
      text = `Memory does not reduce uncertainty — traces that used retrieved chunks wrote with ${fmt(delta)} bits higher mean token entropy (retrieved context may add noise).`;
    }
    if (anecdotal) text += ` Small sample (n=${totalWithEntropy}) — treat as anecdotal, not a finding.`;
    else if (!usable) text += ` Only ${Math.max(used.count, discarded.count)}+${Math.min(used.count, discarded.count)} split is too lopsided to call yet.`;
    return { tone: anecdotal ? "text-amber-400/90" : delta == null ? "text-zinc-500" : Math.abs(delta as number) < 0.1 ? "text-zinc-400" : "text-teal-300/90", text };
  }, [delta, used.count, discarded.count, totalWithEntropy]);

  const exportCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows: string[] = ["id,group,model,mean_entropy,p95_entropy,mean_surprisal,high_entropy_count,token_count"];
    for (const t of traces) {
      const e = t.token_entropy;
      if (e?.mean_entropy == null) continue;
      rows.push([
        esc(t.id), classifyTrace(t), esc(t.model_used || "unknown"),
        fmt(e.mean_entropy, 4), fmt(e.p95_entropy, 4), fmt(e.mean_surprisal, 4),
        e.high_entropy_count, e.token_count,
      ].join(","));
    }
    const blob = new Blob(["\ufeff" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "memory-entropy-by-chunk-usage.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onEnter = (key: GroupKey, e: React.MouseEvent) => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      setTip({ x: e.clientX, y: e.clientY });
      setHovered(key);
    }, 80);
  };
  const onLeave = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    setHovered(null);
  };

  const hoverGroup = hovered ? groups.find((g) => g.key === hovered) : null;

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-mono tracking-wider text-zinc-400">
            Does memory actually ground answers?
          </span>
          <span className="text-[9px] font-mono text-zinc-600 max-w-[340px] leading-relaxed">
            Mean token entropy of the response (normalized top-k distribution, bits) grouped by whether retrieved
            memory chunks were incorporated, discarded, or absent. Lower entropy = the model wrote with less
            uncertainty between likely continuations.
          </span>
        </div>
        <button
          onClick={exportCsv}
          disabled={totalWithEntropy === 0}
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

      {totalWithEntropy === 0 ? (
        <div className="flex flex-col gap-2 py-6">
          <span className="text-[10px] font-mono text-zinc-500">No token-entropy data yet.</span>
          <span className="text-[9px] font-mono text-zinc-600 max-w-[380px] leading-relaxed">
            Entropy is captured per response on OpenAI-protocol workers (e.g. gpt-oss:20B). New traces with{" "}
            <code className="text-zinc-500">token_entropy</code> will populate this panel — the existing corpus
            predates the feature.
          </span>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {groups.map((g) => {
              const widthPct = g.meanEntropy != null ? Math.max(3, (g.meanEntropy / maxEntropy) * 100) : 0;
              return (
                <div
                  key={g.key}
                  className="flex items-center gap-2 cursor-help"
                  onMouseEnter={(e) => onEnter(g.key, e)}
                  onMouseLeave={onLeave}
                >
                  <span className="text-[9px] font-mono text-zinc-500 w-[110px] shrink-0 truncate">{g.label}</span>
                  <div className="flex-1 h-2.5 rounded-full bg-white/[0.04] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${widthPct}%`, backgroundColor: g.color, opacity: g.count === 0 ? 0.25 : 0.85 }}
                    />
                  </div>
                  <span className="text-[9px] font-mono text-zinc-300 w-[46px] text-right shrink-0">
                    {fmt(g.meanEntropy)} b
                  </span>
                  <span className="text-[8px] font-mono text-zinc-600 w-[52px] text-right shrink-0">
                    n={g.count}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2 border-t border-white/[0.04] pt-2">
            <span className="text-[9px] font-mono text-zinc-500">
              Δ used − discarded
            </span>
            <span className={`text-[11px] font-mono font-semibold ${delta == null ? "text-zinc-600" : delta < 0 ? "text-teal-300" : delta > 0.1 ? "text-amber-400" : "text-zinc-400"}`}>
              {delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)} bits`}
            </span>
          </div>

          <p className={`text-[10px] font-mono leading-relaxed ${verdict.tone}`}>{verdict.text}</p>
        </>
      )}

      {hoverGroup && hoverGroup.count > 0 && createPortal(
        <div
          className="pointer-events-none fixed z-[100] rounded-lg border border-white/10 bg-[#0b1b22]/95 px-3 py-2 shadow-xl"
          style={{ left: tip.x + 14, top: tip.y + 14 }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: hoverGroup.color }} />
            <span className="text-[10px] font-mono text-zinc-200">{hoverGroup.label}</span>
          </div>
          <div className="flex flex-col gap-0.5 text-[9px] font-mono text-zinc-400">
            <span>traces: {hoverGroup.count}</span>
            <span>mean entropy: {fmt(hoverGroup.meanEntropy)} bits</span>
            <span>p95 entropy: {fmt(hoverGroup.p95Entropy)} bits</span>
            <span>mean surprisal: {fmt(hoverGroup.meanSurprisal)} bits</span>
            <span>uncertain tokens: {hoverGroup.highTokens}/{hoverGroup.totalTokens}</span>
            <span className="mt-0.5 text-zinc-600">models: {[...hoverGroup.models.entries()].map(([m, c]) => `${m}(${c})`).join(" · ")}</span>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
