"use client";
import { useState } from "react";

interface Props {
  step5Output: string;
  step6Output: string;
}

// Pattern groups
const STRONG_AFFIRM = [
  /\byes[,\s]+\w+\s+(can|do|am|have|will)\b/i,
  /\bi\s+(can|do|am|have|will)\b/i,
  /\bi\s+can\s+access\b/i,
  /\bi\s+have\s+access\b/i,
  /\bi\s+am\s+able\b/i,
  /\byes\b/i,
];
const WEAK_AFFIRM = [
  /\bprevious\s+(interactions|conversation|messages|queries|chats)\b/i,
  /\byour\s+(past|previous|conversation)\s+history\b/i,
  /\bcontext\s+of\s+(previous|past|your)\b/i,
  /\bbased\s+on\s+(your|past|previous)\b/i,
  /\byour\s+(earlier|past|previous)\b/i,
  /\bin\s+previous\b/i,
];
const STRONG_NEGATE = [
  /\bi\s+(can't|cannot|don't|won't)\b/i,
  /\bi\s+do\s+not\b/i,
  /\bunable\b/i,
  /\bcannot\s+(provide|access|retrieve|see|read)\b/i,
  /\bdo\s+not\s+(store|retain|have|keep|maintain|access)\b/i,
  /\bdon't\s+(store|retain|have|keep|access)\b/i,
  /\bno\s+(access|way|ability|record|history)\b/i,
  /\bnot\s+able\b/i,
  /\bis\s+not\s+able\b/i,
  /\bam\s+not\s+able\b/i,
  /\bno[,\s]+\w+\s+(can't|cannot|don't|am not|haven't|won't)\b/i,
];
const WEAK_NEGATE = [
  /\bno\b/i,
  /\bcannot\s+read\b/i,
  /\bcannot\s+see\b/i,
  /\bi\s+don't\s+have\s+(access|the\s+ability)\b/i,
  /\bdo\s+not\s+have\s+(capability|means)\b/i,
];

const TOPIC_PAT = /\b(previous|access|history|conversation|past|interactions?|store|retain|provide|unable|memory|record|data|privacy)\b/i;

function topicWords(s: string): string[] {
  const m = s.toLowerCase().match(TOPIC_PAT);
  if (!m) return [];
  return [...new Set(m)];
}

function classify(sentence: string): "affirms" | "denies" | null {
  const s = sentence.toLowerCase();
  // Discount "I (can|do|am|have|will)" when negated
  let affScore = STRONG_AFFIRM.filter((p) => p.test(s)).length * 2 +
                 WEAK_AFFIRM.filter((p) => p.test(s)).length;
  if (/\bi\s+(can|do|am|have|will)\s+not\b/i.test(s)) affScore -= 2;
  affScore = Math.max(0, affScore);

  const negScore = STRONG_NEGATE.filter((p) => p.test(s)).length * 2 +
                 WEAK_NEGATE.filter((p) => p.test(s)).length;

  if (affScore > negScore) return "affirms";
  if (negScore > affScore) return "denies";
  return null;
}

export function detectContradiction(a: string, b: string): {
  topic: string;
  aClaim: string;
  bClaim: string;
  aPolarity: "affirms" | "denies";
  bPolarity: "affirms" | "denies";
} | null {
  // 1. Both outputs must address a topic-relevant domain.  Since both
  //    are responding to the same user prompt, any topic words in both
  //    implies they're talking about the same thing.
  const aTw = [...new Set((a.toLowerCase().match(TOPIC_PAT) || []))];
  const bTw = [...new Set((b.toLowerCase().match(TOPIC_PAT) || []))];
  if (aTw.length === 0 || bTw.length === 0) return null;
  const topicUnion = [...new Set([...aTw, ...bTw])];

  // 2. Find the sentence with the strongest polarity in each output
  const split = (t: string) => t.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  const aSents = split(a);
  const bSents = split(b);

  const score = (s: string): number => {
    const c = classify(s);
    if (!c) return 0;
    const affPats = [...STRONG_AFFIRM, ...WEAK_AFFIRM];
    const negPats = [...STRONG_NEGATE, ...WEAK_NEGATE];
    const affScore = affPats.filter((p) => p.test(s)).length;
    const negScore = negPats.filter((p) => p.test(s)).length;
    const topicBonus = topicWords(s).filter((w) => topicUnion.includes(w)).length;
    if (c === "affirms") return affScore + topicBonus;
    return -(negScore + topicBonus);
  };

  const pick = (sents: string[], want: "affirms" | "denies"): string => {
    const scored = sents.map((s) => ({ s, score: score(s) }));
    scored.sort((a, b) =>
      want === "affirms" ? b.score - a.score : a.score - b.score
    );
    // Find the first with the correct sign
    for (const x of scored) {
      if (want === "affirms" && x.score > 0) return x.s;
      if (want === "denies" && x.score < 0) return x.s;
    }
    return scored[0].s;
  };

  // Determine which stage leans which way based on strongest single sentence
  const aTopScore = score(aSents[0] || a);
  const bTopScore = score(bSents[0] || b);

  let aPol: "affirms" | "denies";
  let bPol: "affirms" | "denies";
  let aClaim: string;
  let bClaim: string;

  // Try a=affirms, b=denies first
  if (aTopScore > 0) {
    aPol = "affirms";
    aClaim = pick(aSents, "affirms");
  } else {
    aPol = "denies";
    aClaim = pick(aSents, "denies");
  }

  if (bTopScore < 0) {
    bPol = "denies";
    bClaim = pick(bSents, "denies");
  } else {
    bPol = "affirms";
    bClaim = pick(bSents, "affirms");
  }

  if (aPol === bPol) return null;

  return {
    topic: topicUnion.slice(0, 3).join(", "),
    aClaim,
    bClaim,
    aPolarity: aPol,
    bPolarity: bPol,
  };
}

export default function StageDebate({ step5Output, step6Output }: Props) {
  const [collapsed, setCollapsed] = useState(true);
  const conflict = detectContradiction(step5Output, step6Output);

  if (!conflict) {
    return (
      <div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full p-2 rounded-xl bg-white/[0.02] border border-white/[0.05] text-[9px] font-mono tracking-wider text-zinc-600 hover:text-zinc-400 hover:border-zinc-600 transition-all flex items-center gap-2"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-600">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
          <span>No stage conflicts detected</span>
          <span className="ml-auto text-zinc-600">{collapsed ? "▸" : "▾"} Inspect</span>
        </button>
        {!collapsed && (
          <div className="mt-2 p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
            <div className="grid grid-cols-2 gap-0 relative">
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/[0.06]" />
              <div className="pr-3">
                <div className="text-[8px] font-mono text-zinc-600 mb-1">Context Assembly</div>
                <div className="text-[9px] text-zinc-400 font-mono leading-relaxed bg-white/[0.02] rounded px-1.5 py-1">
                  {step5Output}
                </div>
              </div>
              <div className="pl-3">
                <div className="text-[8px] font-mono text-zinc-600 mb-1">Response Generation</div>
                <div className="text-[9px] text-zinc-400 font-mono leading-relaxed bg-white/[0.02] rounded px-1.5 py-1">
                  {step6Output}
                </div>
              </div>
            </div>
            <div className="text-[7px] text-zinc-600 mt-2 text-center">Both stages are aligned — no contradiction detected</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-3 rounded-xl bg-violet-glow/[0.06] border border-violet-glow/[0.12]">
      <div className="flex items-center gap-1.5 text-violet-glow/70 mb-2">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
        <span className="text-[9px] font-semibold tracking-widest uppercase">
          Internal Debate
        </span>
      </div>

      <div className="grid grid-cols-2 gap-0 relative">
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-violet-glow/10" />

        <div className="pr-3">
          <div className="flex items-center gap-1 mb-1">
            <span
              className={`w-1 h-1 rounded-full ${
                conflict.aPolarity === "affirms" ? "bg-emerald-400" : "bg-rose-400"
              }`}
            />
            <span className="text-[8px] font-mono text-zinc-500">Context Assembly</span>
            <span className={`text-[7px] font-mono ml-auto ${
              conflict.aPolarity === "affirms" ? "text-emerald-500/60" : "text-rose-400/60"
            }`}>
              {conflict.aPolarity}
            </span>
          </div>
          <div className="text-[9px] text-zinc-300 font-mono leading-relaxed bg-white/[0.02] rounded px-1.5 py-1">
            {conflict.aClaim}
          </div>
        </div>

        <div className="pl-3">
          <div className="flex items-center gap-1 mb-1">
            <span
              className={`w-1 h-1 rounded-full ${
                conflict.bPolarity === "affirms" ? "bg-emerald-400" : "bg-rose-400"
              }`}
            />
            <span className="text-[8px] font-mono text-zinc-500">Response Generation</span>
            <span className={`text-[7px] font-mono ml-auto ${
              conflict.bPolarity === "affirms" ? "text-emerald-500/60" : "text-rose-400/60"
            }`}>
              {conflict.bPolarity}
            </span>
          </div>
          <div className="text-[9px] text-zinc-300 font-mono leading-relaxed bg-white/[0.02] rounded px-1.5 py-1">
            {conflict.bClaim}
          </div>
        </div>
      </div>

      <div className="mt-2 pt-2 border-t border-violet-glow/10">
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] font-mono text-zinc-600">Topic:</span>
          <span className="text-[8px] font-mono text-zinc-400">{conflict.topic}</span>
          <span className="ml-auto text-[7px] font-mono uppercase tracking-wider text-violet-glow/50">
            stage conflict
          </span>
        </div>
        <div className="text-[8px] text-zinc-500 mt-1 leading-relaxed italic">
          Two stages generated opposing claims about the same topic —
          Context Assembly feeds Response Generation its prompt context, but
          the response contradicted what the synthesis implied. This tension
          reveals how assumptions break as information flows
          through the pipeline.
        </div>
      </div>
    </div>
  );
}
