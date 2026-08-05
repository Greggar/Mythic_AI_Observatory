import type { TraceSession } from "@/types/trace";

export type CorrectionSignalKey = "margin-collapse" | "self-ref-retrieval" | "meta-language";

export interface CorrectionSignal {
  key: CorrectionSignalKey;
  weight: number;
  detail: string;
}

export interface CorrectionResult {
  detected: boolean;
  score: number;
  signals: CorrectionSignal[];
}

export const CORRECTION_THRESHOLD = 0.6;

const MARGIN_COLLAPSE = 0.03;

const W = { "margin-collapse": 0.2, "self-ref-retrieval": 0.2, "meta-language": 0.6 } as const;

const META_LANGUAGE: RegExp[] = [
  /\b(i (was not|wasn'?t|did not|didn'?t|am not|m not) (intending|meaning|trying|asking|wanting|requesting|referring|saying))\b/i,
  /\b(that'?s not what i (said|meant|asked|wanted|intended))\b/i,
  /\b(i (meant|didn'?t mean|did not mean) (that|what))\b/i,
  /\b(you (misunderstood|misread|misheard|got it wrong|missed the point))\b/i,
  /\b(not (what i asked|what i wanted|what i meant|a poem|the point))\b/i,
  /\b(when i (said|wrote|wrote that))\b/i,
  /\b(i was just saying)\b/i,
  /\b(don'?t (write|make|turn|do) (that|it|this))\b/i,
  /\bno[,:]? i ('?m|am) not\b/i,
];

function ddcMargin(t: TraceSession): number | null {
  const m = t.ddc?.prompt?.margin;
  if (m == null || typeof m !== "number") return null;
  return m;
}

function retrievalSelfRef(t: TraceSession, prevId: string): string | null {
  const step = t.steps?.find((s) => s.label === "Memory Retrieval");
  const chunks = step?.metadata?.retrieved_chunks;
  if (!Array.isArray(chunks) || chunks.length === 0) return null;
  const hit = chunks.find((c) => (c as { trace_id?: string }).trace_id === prevId);
  return hit ? `retrieved prior exchange ${prevId.slice(0, 8)} as grounding` : null;
}

export function detectCorrection(prev: TraceSession, cur: TraceSession): CorrectionResult {
  const signals: CorrectionSignal[] = [];

  const margin = ddcMargin(cur);
  if (margin != null && margin < MARGIN_COLLAPSE) {
    signals.push({
      key: "margin-collapse",
      weight: W["margin-collapse"],
      detail: `DDC prompt margin ${margin.toFixed(3)} < ${MARGIN_COLLAPSE} — classifier confident but near-tie`,
    });
  }

  const selfRef = retrievalSelfRef(cur, prev.id);
  if (selfRef) {
    signals.push({ key: "self-ref-retrieval", weight: W["self-ref-retrieval"], detail: selfRef });
  }

  if (META_LANGUAGE.some((re) => re.test(cur.prompt))) {
    signals.push({
      key: "meta-language",
      weight: W["meta-language"],
      detail: "prompt uses correction/meta framing (\"I was not intending\", \"you misunderstood\", etc.)",
    });
  }

  const score = signals.reduce((s, sg) => s + sg.weight, 0);
  return { detected: score >= CORRECTION_THRESHOLD, score: Math.min(1, score), signals };
}

export function findCorrections(exchanges: TraceSession[]): { ex: number; prevEx: number; result: CorrectionResult }[] {
  const sorted = [...exchanges]
    .filter((t) => t.status === "complete")
    .sort((a, b) => (a.exchange_index ?? 0) - (b.exchange_index ?? 0));
  const out: { ex: number; prevEx: number; result: CorrectionResult }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const result = detectCorrection(sorted[i - 1], sorted[i]);
    if (result.detected) {
      out.push({ ex: sorted[i].exchange_index ?? 0, prevEx: sorted[i - 1].exchange_index ?? 0, result });
    }
  }
  return out;
}
