"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";
import type { TraceSession } from "@/types/trace";

interface Props {
  exchanges: TraceSession[];
}

const MOOD5_LABELS = ["Imperative", "Indicative", "Interrogative", "Conditional", "Subjunctive"];

function classifyMood5(prompt: string): number {
  const t = prompt.trim();
  if (!t) return 0;
  if (/^(if|when|whenever|should|unless|provided that|assuming|given that)\b/i.test(t) || /\b(if .+ then|if you|when you|unless you)\b/i.test(t)) return 3;
  if (/^(act as|imagine|pretend|suppose|picture|consider what if|what would|what if)\b/i.test(t) || /\b(as if|as though|act like|speak as|role.?play)\b/i.test(t)) return 4;
  if (t.endsWith("?") || /^(what|how|why|where|when|which|could|would|should|can|do|does|is|are|will)\b/i.test(t)) return 2;
  if (/^(the|this|that|there|it|we|they|he|she|i)\b/i.test(t) || /^[A-Z]/.test(t)) return 1;
  return 0;
}

function topIntent(t: TraceSession): string {
  const step = t.steps?.find((s) => s.label === "Intent Classification");
  const probs = step?.metadata?.intent_probs;
  if (Array.isArray(probs) && probs.length > 0 && probs[0]) {
    return String((probs[0] as { label?: string }).label ?? "");
  }
  return "";
}

function mainClass(code: string | undefined): string {
  if (!code) return "";
  return code.replace(/[^0-9]/g, "").slice(0, 1);
}

function memStats(t: TraceSession): { total: number; used: number; rel: number } | null {
  const step = t.steps?.find((s) => s.label === "Memory Retrieval");
  const chunks = step?.metadata?.retrieved_chunks;
  if (!Array.isArray(chunks) || chunks.length === 0) return null;
  const used = chunks.filter((c) => (c as { used?: boolean }).used).length;
  const rel = chunks.reduce((s, c) => s + ((c as { relevance?: number }).relevance ?? 0), 0) / chunks.length;
  return { total: chunks.length, used, rel };
}

function pctTone(v: number): string {
  return v >= 70 ? "text-teal-mystic" : v >= 45 ? "text-solar-gold" : "text-red-400";
}

function volTone(v: number): string {
  return v <= 30 ? "text-teal-mystic" : v <= 55 ? "text-solar-gold" : "text-red-400";
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function ChatMetrics({ exchanges }: Props) {
  const M = useMemo(() => {
    const pts = [...exchanges]
      .filter((t) => t.status === "complete")
      .sort((a, b) => (a.exchange_index ?? 0) - (b.exchange_index ?? 0))
      .map((t) => ({
        id: t.id,
        ex: t.exchange_index ?? 0,
        intent: topIntent(t),
        mood: MOOD5_LABELS[classifyMood5(t.prompt)],
        ddcP: mainClass(t.ddc?.prompt?.code),
        ddcR: mainClass(t.ddc?.response?.code),
        mean: t.token_entropy?.mean_entropy ?? null,
        tokens: t.token_entropy?.token_count ?? 0,
        mem: memStats(t),
        dur: t.completed_at && t.created_at
          ? new Date(t.completed_at).getTime() - new Date(t.created_at).getTime()
          : null,
        model: t.model_used,
      }));

    const n = pts.length;
    const tx = Math.max(0, n - 1);

    let intentSame = 0, intentTx = 0, moodSame = 0, ddcPChange = 0, ddcPTx = 0, ddcRChange = 0, ddcRTx = 0;
    for (let i = 1; i < n; i++) {
      const a = pts[i - 1], b = pts[i];
      if (a.intent && b.intent) {
        intentTx++;
        if (a.intent === b.intent) intentSame++;
      }
      if (a.mood === b.mood) moodSame++;
      if (a.ddcP && b.ddcP) { ddcPTx++; if (a.ddcP !== b.ddcP) ddcPChange++; }
      if (a.ddcR && b.ddcR) { ddcRTx++; if (a.ddcR !== b.ddcR) ddcRChange++; }
    }

    const em = pts.filter((p) => p.mean != null);
    let slope = 0;
    if (em.length >= 2) {
      const xs = em.map((_, i) => i);
      const ys = em.map((p) => p.mean!);
      const xm = xs.reduce((a, b) => a + b, 0) / xs.length;
      const ym = ys.reduce((a, b) => a + b, 0) / ys.length;
      let num = 0, den = 0;
      for (let i = 0; i < xs.length; i++) {
        num += (xs[i] - xm) * (ys[i] - ym);
        den += (xs[i] - xm) ** 2;
      }
      slope = den ? num / den : 0;
    }

    const mems = pts.filter((p) => p.mem);
    const utilPct = mems.length ? (mems.reduce((s, p) => s + p.mem!.used / p.mem!.total, 0) / mems.length) * 100 : null;
    const avgRel = mems.length ? mems.reduce((s, p) => s + p.mem!.rel, 0) / mems.length : null;

    return {
      pts,
      n,
      intentConsistency: intentTx ? (intentSame / intentTx) * 100 : null,
      ddcPVel: ddcPTx ? (ddcPChange / ddcPTx) * 100 : null,
      ddcRVel: ddcRTx ? (ddcRChange / ddcRTx) * 100 : null,
      moodVolatility: tx ? ((tx - moodSame) / tx) * 100 : null,
      utilPct,
      avgRel,
      slope,
      direction: slope > 0.02 ? "rising" : slope < -0.02 ? "falling" : "flat",
      tokens: pts.reduce((s, p) => s + p.tokens, 0),
      duration: pts.reduce((s, p) => s + (p.dur ?? 0), 0),
      models: Array.from(new Set(pts.map((p) => p.model).filter((m): m is string => !!m))),
    };
  }, [exchanges]);

  if (M.n === 0) return null;

  const hasTransitions = M.n >= 2;
  const sparkW = 108, sparkH = 30;
  const sparkPts = M.pts.filter((p) => p.mean != null);
  const sparkMax = Math.max(...sparkPts.map((p) => p.mean!), 0.25);
  const sparkPath = sparkPts.map((p, i) => {
    const x = sparkPts.length === 1 ? sparkW / 2 : (i / (sparkPts.length - 1)) * sparkW;
    const y = sparkH - 4 - (p.mean! / sparkMax) * (sparkH - 8);
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="glass-panel p-4"
    >
      <div className="flex items-center justify-between px-0.5 mb-2">
        <span className="text-[9px] font-mono tracking-wider text-zinc-600 uppercase">
          Session Metrics
        </span>
        <span className="text-[9px] font-mono text-zinc-600">
          EX0–EX{M.n - 1}
        </span>
      </div>

      {!hasTransitions ? (
        <div className="text-[10px] font-mono text-zinc-600 px-0.5">
          Send a second exchange to measure drift, volatility, and consistency.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Intent consistency */}
          <div className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-3 space-y-1.5">
            <div className="text-[9px] font-mono tracking-wider text-zinc-600 uppercase">Intent consistency</div>
            <div className={`text-xl font-mono ${M.intentConsistency != null ? pctTone(M.intentConsistency) : "text-zinc-600"}`}>
              {M.intentConsistency != null ? `${M.intentConsistency.toFixed(0)}%` : "—"}
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              {M.pts.map((p, i) => (
                <div key={`${p.id}-ic`} className="flex items-center gap-1">
                  {i > 0 && (
                    <span className={`text-[9px] ${p.intent && p.intent === M.pts[i - 1].intent ? "text-teal-mystic" : "text-red-400"}`}>
                      {p.intent && p.intent === M.pts[i - 1].intent ? "=" : "≠"}
                    </span>
                  )}
                  <span className="text-[9px] font-mono text-zinc-500">{p.intent ? p.intent.split("_").slice(0, 2).join(" ") : "—"}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Topic drift */}
          <div className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-3 space-y-1.5">
            <div className="text-[9px] font-mono tracking-wider text-zinc-600 uppercase">Topic drift (DDC main class)</div>
            {[
              { label: "prompt", v: M.ddcPVel },
              { label: "response", v: M.ddcRVel },
            ].map((row) => (
              <div key={row.label} className="space-y-0.5">
                <div className="flex justify-between text-[10px] font-mono">
                  <span className="text-zinc-500">{row.label}</span>
                  <span className={row.v != null ? volTone(row.v) : "text-zinc-600"}>
                    {row.v != null ? `${row.v.toFixed(0)}% /turn` : "—"}
                  </span>
                </div>
                <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-solar-gold"
                    style={{ width: `${row.v != null ? Math.min(row.v, 100) : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Mood volatility */}
          <div className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-3 space-y-1.5">
            <div className="text-[9px] font-mono tracking-wider text-zinc-600 uppercase">Mood volatility</div>
            <div className={`text-xl font-mono ${M.moodVolatility != null ? volTone(M.moodVolatility) : "text-zinc-600"}`}>
              {M.moodVolatility != null ? `${M.moodVolatility.toFixed(0)}%` : "—"}
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              {M.pts.map((p, i) => (
                <div key={`${p.id}-mv`} className="flex items-center gap-1">
                  {i > 0 && (
                    <span className={`text-[9px] ${p.mood === M.pts[i - 1].mood ? "text-teal-mystic" : "text-red-400"}`}>
                      {p.mood === M.pts[i - 1].mood ? "=" : "≠"}
                    </span>
                  )}
                  <span className="text-[9px] font-mono text-zinc-500">{p.mood.slice(0, 6)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Context utilization */}
          <div className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-3 space-y-1.5">
            <div className="text-[9px] font-mono tracking-wider text-zinc-600 uppercase">Context utilization</div>
            <div className={`text-xl font-mono ${M.utilPct != null ? pctTone(M.utilPct) : "text-zinc-600"}`}>
              {M.utilPct != null ? `${M.utilPct.toFixed(0)}%` : "—"}
            </div>
            <div className="flex items-center gap-1">
              {M.pts.map((p) => {
                const m = p.mem;
                const u = m ? (m.used / m.total) * 100 : 0;
                return (
                  <div
                    key={`${p.id}-cu`}
                    title={`EX${p.ex}: ${m ? `${m.used}/${m.total} chunks · rel ${m.rel.toFixed(3)}` : "no retrieval"}`}
                    className={`flex-1 h-1.5 rounded-full ${m ? "bg-white/[0.06]" : "bg-white/[0.02]"}`}
                  >
                    <div
                      className={`h-full rounded-full ${m ? "bg-teal-mystic" : "bg-transparent"}`}
                      style={{ width: `${u}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="text-[9px] font-mono text-zinc-600">
              avg relevance {M.avgRel != null ? M.avgRel.toFixed(3) : "—"}
            </div>
          </div>

          {/* Entropy trend */}
          <div className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-3 space-y-1.5">
            <div className="text-[9px] font-mono tracking-wider text-zinc-600 uppercase">Entropy trend</div>
            <div className="flex items-center gap-2">
              <span className={`text-xl font-mono ${M.direction === "falling" ? "text-teal-mystic" : M.direction === "rising" ? "text-red-400" : "text-zinc-400"}`}>
                {M.direction === "rising" ? "↗" : M.direction === "falling" ? "↘" : "→"}
              </span>
              <span className="text-[10px] font-mono text-zinc-500">
                {M.direction === "rising" ? "uncertainty climbing" : M.direction === "falling" ? "uncertainty settling" : "flat"}
                <span className="text-zinc-600"> · slope {M.slope.toFixed(3)}/ex</span>
              </span>
            </div>
            <svg viewBox={`0 0 ${sparkW} ${sparkH}`} className="w-full h-auto">
              <path d={sparkPath} fill="none" stroke={M.direction === "rising" ? "#f87171" : M.direction === "falling" ? "#2dd4bf" : "#a1a1aa"} strokeWidth={1.6} />
            </svg>
          </div>

          {/* Session summary */}
          <div className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-3 space-y-1">
            <div className="text-[9px] font-mono tracking-wider text-zinc-600 uppercase">Session</div>
            {[
              ["exchanges", String(M.n)],
              ["tokens", String(M.tokens)],
              ["runtime", fmtDuration(M.duration)],
              ["models", M.models.length ? M.models.join(", ") : "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-[10px] font-mono">
                <span className="text-zinc-600">{k}</span>
                <span className="text-zinc-300 truncate ml-2">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
