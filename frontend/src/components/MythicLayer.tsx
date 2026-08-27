"use client";

import type { TraceSession } from "@/types/trace";

export interface MythicPhenomenon {
  id: string;
  name: string;
  definition: string;
  severity: "whisper" | "surge" | "torrent";
  icon: string;
}

/**
 * Mythic Layer — Phase 18 #8.
 *
 * Recurring measurable phenomena get a name ("damnata technice, servata veneratione" —
 * the technical definition stays visible beside the name). Every phenomenon here is
 * derived from data we already capture; nothing is invented. Truth over polish.
 *
 * Severity thresholds are calibrated to the live corpus (2026-08): high-entropy ratio
 * caps at ~0.28 with median ~0.07; entropy-series peaks cluster near 1.0. So
 * "serious" tiers are set where they are genuinely rare, not at the arbitrary 0.5-ish
 * any metric would produce on a synthetic distribution.
 */
const HIGHRATIO_SURGE = 0.08; // above corpus median of ~0.07
const HIGHRATIO_TORRENT = 0.15; // top decile — genuinely dense guessing
const SERPENT_PEAK = 2.0; // single-token entropy peak reserved for the extreme outliers
const BRANCH_LOW = 1.05; // below the typical 2^H median floor of ~1.2
const BRANCH_HIGH = 4.0;

function maxOf(a: number[] | undefined): number {
  if (!a || a.length === 0) return 0;
  return Math.max(...a);
}

function highEntropyRatio(ent: TraceSession["token_entropy"] | undefined): number {
  if (!ent || !ent.token_count) return 0;
  return ent.high_entropy_count / ent.token_count;
}

function selfRefHit(t: TraceSession): string | null {
  const step = t.steps?.find((s) => s.label === "Memory Retrieval");
  const chunks = step?.metadata?.retrieved_chunks;
  if (!Array.isArray(chunks) || chunks.length === 0) return null;
  const hit = chunks.find((c) => (c as { trace_id?: string }).trace_id === t.id);
  if (!hit) return null;
  return ((hit as { trace_id?: string }).trace_id ?? "").slice(0, 8) || null;
}

export function derivePhenomena(t: TraceSession): MythicPhenomenon[] {
  const out: MythicPhenomenon[] = [];
  const ent = t.token_entropy;

  const highCount = ent?.high_entropy_count ?? 0;
  const ratio = highEntropyRatio(ent);
  const maxH = maxOf(ent?.series);
  const branch = ent?.median_branching;

  if (highCount > 0) {
    const severity: MythicPhenomenon["severity"] =
      ratio >= HIGHRATIO_TORRENT ? "torrent" : ratio >= HIGHRATIO_SURGE ? "surge" : "whisper";
    out.push({
      id: "whispering-forest",
      name: "The Whispering Forest",
      definition:
        `${highCount} token${highCount === 1 ? "" : "s"} of ${ent?.token_count ?? "?"} at high entropy (mean ${ent?.mean_entropy?.toFixed(3) ?? "?"}, ` +
        `p95 ${ent?.p95_entropy?.toFixed(3) ?? "?"}${branch != null ? `, median 2^H ${branch.toFixed(2)}` : ""}) — the model entertained many competing continuations.`,
      severity,
      icon: "🌲",
    });
  }

  const maxBranching = maxOf(ent?.branching_series);
  if (branch != null && branch >= BRANCH_HIGH) {
    out.push({
      id: "burning-bush",
      name: "The Burning Bush",
      definition:
        `median branching ${branch.toFixed(2)} (peak ${maxBranching.toFixed(2)}) — nearly every token had ${Math.round(branch)}+ plausible continuations; the boundary between known and guessed was smeared.`,
      severity: "torrent",
      icon: "🔥",
    });
  }

  if (ent && maxH > 0 && maxH >= SERPENT_PEAK) {
    out.push({
      id: "serpents-crown",
      name: "The Serpent's Crown",
      definition: `a single token peaked at entropy ${maxH.toFixed(3)} — one decisive guess under maximal uncertainty.`,
      severity: "surge",
      icon: "🐍",
    });
  }

  const selfRef = selfRefHit(t);
  if (selfRef) {
    out.push({
      id: "mirror-pool",
      name: "The Mirror Pool",
      definition:
        `memory retrieval pulled this trace's own earlier artifact (ex ${selfRef}) as grounding — the model is reasoning about itself.`,
      severity: "surge",
      icon: "🪞",
    });
  }

  const deterministic = branch != null && branch <= BRANCH_LOW && maxH <= 0.08;
  if (deterministic) {
    out.push({
      id: "still-waters",
      name: "The Still Waters",
      definition: `median branching ${branch.toFixed(2)} — with ≤${BRANCH_LOW.toFixed(1)} plausible continuations, the model was effectively reading from a script.`,
      severity: "whisper",
      icon: "🌊",
    });
  }

  return out;
}

const SEVERITY_STYLE: Record<MythicPhenomenon["severity"], string> = {
  whisper: "border-teal-mystic/30 bg-teal-mystic/5",
  surge: "border-amber-400/40 bg-amber-400/10",
  torrent: "border-rose-400/50 bg-rose-400/10",
};

export default function MythicLayer({ trace }: { trace: TraceSession }) {
  const phenomena = derivePhenomena(trace);
  if (phenomena.length === 0) return null;

  return (
    <div className="glass-panel rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[8px] font-mono tracking-[0.25em] uppercase text-zinc-500">
          Mythic Layer — phenomena of this trace
        </div>
        <div className="text-[8px] font-mono text-zinc-600/60">derived from live telemetry</div>
      </div>
      <div className="space-y-1.5">
        {phenomena.map((p) => (
          <div
            key={p.id}
            className={`rounded-lg border px-2.5 py-1.5 flex items-start gap-2 ${SEVERITY_STYLE[p.severity]}`}
          >
            <span className="text-sm leading-none mt-0.5 select-none" aria-hidden>
              {p.icon}
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-mono text-zinc-200 leading-tight">{p.name}</div>
              <div className="text-[9px] font-mono text-zinc-500 leading-relaxed mt-0.5">{p.definition}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
