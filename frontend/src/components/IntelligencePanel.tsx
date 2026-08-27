"use client";

import { motion } from "framer-motion";
import {
  Brain,
  Cpu,
  Globe,
  Network,
  Clock,
  CheckCircle,
  Sparkles,
  Activity,
} from "lucide-react";
import VectorDistanceGraph from "@/components/VectorDistanceGraph";
import ContextAssemblyBreakdown from "@/components/ContextAssemblyBreakdown";
import type { Telemetry } from "@/hooks/useWebSocket";
import type { TraceSession, TraceStep } from "@/types/trace";
import StageDebate from "@/components/StageDebate";
import TraceRadar from "@/components/TraceRadar";
import ForkInTheRoad from "@/components/ForkInTheRoad";
import TokenVelocity from "@/components/TokenVelocity";
import DualTimeline from "@/components/charts/DualTimeline";
import HallucinationGauge from "@/components/HallucinationGauge";
import SynthesisBridge from "@/components/SynthesisBridge";
import MythicLayer from "@/components/MythicLayer";

interface Props {
  telemetry: Telemetry | null;
  connected: boolean;
  trace: TraceSession | null;
  traceActive: boolean;
  activeStepIndex: number | null;
  phase: "idle" | "replaying" | "complete";
  noTrace?: boolean;
}

function ConfidenceRing({ confidence, cx, cy, r }: { confidence: number; cx: number; cy: number; r: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const circumference = 2 * Math.PI * r;
  const dashLength = circumference * confidence;
  const color = confidence > 0.8 ? "#fbbf24" : confidence > 0.6 ? "#f59e0b" : "#2dd4bf";
  const coronaScale = 0.3 + 0.7 * confidence;

  return (
    <g>
      <defs>
        <radialGradient id="coronaAureole">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="20%" stopColor={color} stopOpacity="0.15" />
          <stop offset="50%" stopColor="#2dd4bf" stopOpacity="0.04" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Solar aureole — breathing glow */}
      <motion.circle cx={cx} cy={cy} r={r * 1.8}
        fill="url(#coronaAureole)"
        animate={mounted ? {
          scale: [1, 1.08, 1],
          opacity: [0.5, 0.9, 0.5],
        } : {}}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        style={{ transformOrigin: "50% 50%" }}
      />
      {/* Corona rays */}
      {mounted && [0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => (
        <motion.line
          key={`ray-${i}`}
          x1={cx} y1={cy}
          x2={cx + r * 1.5 * Math.cos((angle * Math.PI) / 180)}
          y2={cy + r * 1.5 * Math.sin((angle * Math.PI) / 180)}
          stroke={color} strokeWidth="0.4" opacity="0"
          animate={mounted ? {
            opacity: [0, 0.12 * coronaScale, 0],
          } : {}}
          transition={{ duration: 4, delay: i * 0.3, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
      {/* Concentric measurement rings */}
      {[r * 0.3, r * 0.6, r * 0.9].map((radius, i) => (
        <motion.circle key={`ring-${i}`} cx={cx} cy={cy} r={radius}
          fill="none" stroke={color} strokeWidth="0.3"
          strokeDasharray={i === 1 ? "2 4" : i === 2 ? "1 3" : ""}
          animate={mounted ? { opacity: [0.04, 0.1, 0.04], rotate: i % 2 === 0 ? 360 : -360 } : {}}
          transition={{
            opacity: { duration: 5 + i, repeat: Infinity, ease: "easeInOut" },
            rotate: { duration: 30 + i * 10, repeat: Infinity, ease: "linear" },
          }}
          style={{ transformOrigin: "50% 50%" }}
        />
      ))}
      {/* Confidence arc */}
      <motion.circle
        cx={cx} cy={cy} r={r}
        fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"
        strokeDasharray={`${dashLength} ${circumference - dashLength}`}
        strokeDashoffset={-Math.PI * r * 0.25}
        initial={{ opacity: 0 }}
        animate={mounted ? { opacity: 1 } : {}}
        transition={{ duration: 0.8, ease: "easeOut" }}
      />
      {/* Glow overlay on arc */}
      <motion.circle
        cx={cx} cy={cy} r={r + 2}
        fill="none" stroke={color} strokeWidth="1" strokeLinecap="round"
        strokeDasharray={`${dashLength} ${circumference - dashLength}`}
        strokeDashoffset={-Math.PI * r * 0.25}
        animate={mounted ? {
          opacity: [0.12, 0.35, 0.12],
          scale: [1, 1.03, 1],
        } : {}}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        style={{ filter: `drop-shadow(0 0 4px ${color})`, transformOrigin: "50% 50%" }}
      />
      {/* Planetary confidence indicators */}
      {mounted && [
        { angle: 30, r2: r * 0.4, size: 2 },
        { angle: 120, r2: r * 0.55, size: 2.5 },
        { angle: 210, r2: r * 0.35, size: 1.5 },
        { angle: 300, r2: r * 0.5, size: 2 },
      ].map((p, i) => {
        const px = cx + p.r2 * Math.cos((p.angle * Math.PI) / 180);
        const py = cy + p.r2 * Math.sin((p.angle * Math.PI) / 180);
        return (
          <motion.circle key={`planet-${i}`}
            cx={px} cy={py} r={p.size}
            fill={color}
            animate={{ opacity: [0.3, 0.8, 0.3] }}
            transition={{ duration: 3 + i * 0.5, delay: i * 0.4, repeat: Infinity, ease: "easeInOut" }}
          />
        );
      })}
      {/* Centre core */}
      <motion.circle cx={cx} cy={cy} r={r * 0.25}
        fill={color}
        animate={mounted ? { r: [r * 0.25, r * 0.32, r * 0.25], opacity: [0.6, 0.9, 0.6] } : {}}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* Centre value */}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
        fill={color} fontSize="13" fontFamily="monospace" fontWeight="bold">
        {Math.round(confidence * 100)}%
      </text>
    </g>
  );
}

interface IntentProb {
  label: string;
  confidence: number;
}

interface RetrievedChunk {
  trace_id: string;
  content: string;
  relevance: number;
  used: boolean;
}

interface VectorPoint {
  id: string;
  label: string;
  relevance?: number;
  used?: boolean;
  is_query: boolean;
}

interface VectorEdge {
  source: string;
  target: string;
  similarity: number;
}

function ThoughtStream({ entries }: { entries: { label: string; text: string; isModel: boolean }[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);
  if (entries.length === 0) return null;
  return (
    <div className="rounded-xl bg-black/40 border border-white/[0.06] overflow-hidden">
      <div className="text-[8px] font-semibold tracking-widest uppercase text-zinc-600 p-2 border-b border-white/[0.04]">
        Thought Stream
      </div>
      <div className="max-h-36 overflow-y-auto p-2 space-y-1.5 font-mono text-[10px] leading-relaxed">
        {entries.map((e, i) => (
          <div key={i}>
            <span className={`${e.isModel ? "text-teal-mystic/70" : "text-zinc-500"}`}>
              [{e.label}]
            </span>
            <span className="text-zinc-400 ml-1">{e.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function ChunkDisplay({ chunks }: { chunks: RetrievedChunk[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<{ group: "used" | "discarded"; idx: number } | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  if (chunks.length === 0) return null;
  const used = chunks.filter((c) => c.used);
  const discarded = chunks.filter((c) => !c.used);

  const renderChunk = (chunk: RetrievedChunk, i: number, group: "used" | "discarded") => {
    const isUsed = group === "used";
    const isHovered = hoveredIdx?.group === group && hoveredIdx?.idx === i;
    return (
      <div
        key={i}
        className="relative p-2 rounded-lg cursor-pointer transition-colors"
        style={{
          backgroundColor: isUsed
            ? `rgba(16, 185, 129, ${isHovered ? 0.08 : 0.04})`
            : `rgba(255, 255, 255, ${isHovered ? 0.04 : 0.02})`,
          borderColor: isUsed
            ? `rgba(16, 185, 129, ${isHovered ? 0.15 : 0.08})`
            : `rgba(255, 255, 255, ${isHovered ? 0.08 : 0.04})`,
          borderWidth: 1,
          borderStyle: "solid",
        }}
        onMouseEnter={() => setHoveredIdx({ group, idx: i })}
        onMouseLeave={() => setHoveredIdx(null)}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px] font-mono truncate flex-1"
            style={{ color: isUsed ? "rgba(16, 185, 129, 0.7)" : "rgba(113, 113, 122, 0.6)" }}>
            {chunk.content}
          </span>
          <span className="text-[8px] font-mono shrink-0"
            style={{ color: isUsed ? "rgba(16, 185, 129, 0.5)" : "rgba(113, 113, 122, 0.4)" }}>
            {Math.round(chunk.relevance * 100)}%
          </span>
        </div>
        {isHovered && (
          <div
            ref={tooltipRef}
            className="absolute left-0 right-0 top-full mt-1 z-50 p-2 rounded-lg text-[10px] font-mono leading-relaxed whitespace-pre-wrap"
            style={{
              backgroundColor: "#1a1a2e",
              border: "1px solid rgba(167, 139, 250, 0.25)",
              color: "rgba(212, 212, 216, 0.9)",
              boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
            }}
          >
            {chunk.content}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <div className="text-[9px] font-semibold tracking-widest uppercase text-zinc-500">
        Retrieved Chunks
      </div>
      {used.length > 0 && (
        <div className="space-y-1">
          <div className="text-[8px] font-mono text-jade-glow/60 tracking-wider uppercase">Used</div>
          {used.map((chunk, i) => renderChunk(chunk, i, "used"))}
        </div>
      )}
      {discarded.length > 0 && (
        <div className="space-y-1">
          <div className="text-[8px] font-mono text-zinc-600 tracking-wider uppercase">Discarded</div>
          {discarded.map((chunk, i) => renderChunk(chunk, i, "discarded"))}
        </div>
      )}
    </div>
  );
}

function IntentProbs({ intents }: { intents: IntentProb[] }) {
  const maxConf = Math.max(...intents.map((i) => i.confidence), 0.01);
  return (
    <div className="mt-2 space-y-1.5">
      <div className="text-[9px] font-semibold tracking-widest uppercase text-zinc-500 mb-1">
        Intent Probabilities
      </div>
      {intents.map((intent, i) => {
        const pct = Math.round(intent.confidence * 100);
        const color =
          intent.confidence > 0.6
            ? "bg-teal-mystic"
            : intent.confidence > 0.25
              ? "bg-solar-gold"
              : "bg-zinc-500";
        return (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-zinc-400 w-20 truncate">{intent.label}</span>
            <div className="flex-1 h-2 rounded-full bg-white/[0.05] overflow-hidden">
              <div
                className={`h-full rounded-full ${color} transition-all duration-500`}
                style={{ width: `${(intent.confidence / maxConf) * 100}%` }}
              />
            </div>
            <span className="text-[10px] font-mono text-zinc-500 w-8 text-right">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";

interface StageInfo {
  label: string;
  desc: string;
}

const STAGES: StageInfo[] = [
  { label: "Request Received",     desc: "Raw prompt enters the system. Parsed and normalized before routing to the orchestration pipeline." },
  { label: "Intent Classification",desc: "Embedding-based classifier assigns one of 13 intent categories via all-minilm cosine similarity — no LLM call, completes in ~73ms." },
  { label: "Model Routing",      desc: "Maps the classified intent to the available execution model. Currently routes to the default handler since only one model backend is available." },
  { label: "Memory Retrieval",     desc: "Vector similarity search over past trace embeddings. Top-5 relevant chunks are tagged as used or discarded based on a relevance threshold." },
  { label: "Context Assembly",    desc: "Retrieved chunks and user input are assembled into the context window. The LLM assembly step was removed for efficiency — primary intent is echoed as synthesised instruction." },
  { label: "Response Generation",  desc: "The selected model generates a response using the assembled context. Streams tokens in real-time." },
  { label: "Output Packaging",       desc: "Output is stored on the trace. Heuristic insights (stage bottlenecks, cold start, service health) are computed from recorded metrics." },
];

const SYSTEM_PROMPTS: Record<string, string | null> = {
  "step-2": null,
  "step-5": null,
  "step-6": "You are a wise and knowledgeable AI oracle. Provide a thoughtful, clear response to the user.",
};

function getSystemPrompt(step: TraceStep | null): string | null {
  if (!step) return null;
  const stepIndex = ["Request Received","Intent Classification","Model Routing","Memory Retrieval","Context Assembly","Response Generation","Output Packaging"].indexOf(step.label);
  if (stepIndex === -1) return null;
  return SYSTEM_PROMPTS[`step-${stepIndex + 1}`] ?? null;
}

function stageDesc(label: string): string {
  return STAGES.find((s) => s.label === label)?.desc || "";
}

export default function IntelligencePanel({
  telemetry,
  connected,
  trace,
  traceActive,
  activeStepIndex,
  phase,
  noTrace = false,
}: Props) {
  const ollamaCount = telemetry?.ollama.count ?? null;
  const remotesOnline = telemetry?.remotes.filter((r) => r.status === "ok").length ?? 0;
  const remotesUnreachable = telemetry ? telemetry.remotes.length - remotesOnline : 0;
  const gwStatus = telemetry?.openclaw.status ?? null;

  const currentStage = activeStepIndex !== null && trace ? trace.steps[activeStepIndex] : null;
  const nextStageIndex = activeStepIndex !== null && trace && activeStepIndex < trace.steps.length - 1
    ? activeStepIndex + 1
    : null;
  const nextStageLabel = nextStageIndex !== null && trace ? trace.steps[nextStageIndex].label : null;
  const totalDuration = trace?.steps.reduce((acc, s) => acc + (s.duration_ms || 0), 0) ?? 0;
  const confidence = trace?.confidence ?? null;
  const insightTags = trace?.insight_tags ?? [];
  const [showContext, setShowContext] = useState(false);
  const [showReplayContext, setShowReplayContext] = useState<string | null>(null);
  const [rootCauseIdx, setRootCauseIdx] = useState<number | null>(null);
  const [showThoughtStream, setShowThoughtStream] = useState(false);

  // Build thought stream entries from completed trace steps
  const thoughtEntries = useMemo(() => {
    if (!trace) return [];
    const entries: { label: string; text: string; isModel: boolean }[] = [];
    for (const step of trace.steps) {
      if (step.status !== "complete") continue;
      const isModel = step.model_used != null;
      const text = step.metadata?.output
        ? (step.metadata.output as string).substring(0, 120)
        : step.context_assembled
          ? step.context_assembled.substring(0, 120)
          : "✓";
      entries.push({ label: step.label, text, isModel });
    }
    return entries;
  }, [trace]);

  const STOPWORDS = new Set([
  "the", "and", "for", "this", "that", "with", "from", "have", "been", "was",
  "are", "has", "had", "but", "not", "what", "all", "were", "when", "where",
  "how", "which", "their", "about", "would", "into", "over", "such", "than",
  "they", "will", "each", "also", "very", "just", "more",
]);

function highlightKeyWords(text: string, query: string): (string | React.ReactNode)[] {
  const queryWords = query
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  if (queryWords.length === 0) return [text];

  const unique = [...new Set(queryWords)];
  const parts = text.split(/\b/);
  return parts.map((part, i) => {
    const lower = part.toLowerCase();
    if (unique.includes(lower)) {
      return (
        <span key={i} className="text-teal-mystic font-semibold">{part}</span>
      );
    }
    return part;
  });
}

function findRootCause(session: TraceSession): { index: number; reason: string } | null {
    const steps = session.steps;
    if (!steps || steps.length === 0) return null;
    // 1. Error stage takes priority
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].status === "error") return { index: i, reason: `${steps[i].label} failed with an error` };
    }
    // 2. Duration outlier — stage more than 2x the median
    const durations = steps.map((s) => s.duration_ms).filter((d): d is number => d !== null);
    if (durations.length > 2) {
      const sorted = [...durations].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      for (let i = 0; i < steps.length; i++) {
        const d = steps[i].duration_ms;
        if (d !== null && d > median * 2 && d > 2000) {
          return { index: i, reason: `${steps[i].label} took ${(d / 1000).toFixed(1)}s — ${(d / median).toFixed(1)}x the median stage duration` };
        }
      }
    }
    // 3. Short output — flag Response Generation
    if (session.output && session.output.length < 50) {
      const respIdx = steps.findIndex((s) => s.label === "Response Generation");
      if (respIdx !== -1) return { index: respIdx, reason: "Response was unusually short (<50 chars)" };
    }
    // 4. No clear culprit
    return null;
  }

  return (
    <div className="glass-panel p-5 space-y-5">
      <div className="flex flex-col items-center gap-1.5 text-solar-gold">
        <Brain size={16} />
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">Intelligence</span>
          <span
            className={`w-2 h-2 rounded-full ${connected ? "bg-jade-glow" : "bg-red-500/50"}`}
          />
        </div>
      </div>

      {/* IDLE STATE — system overview (also shown when noTrace=true on History tab) */}
      {(phase === "idle" || noTrace) && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03]">
            <Network size={14} className="text-teal-mystic" />
            <span className="text-xs text-zinc-400 flex-1">Remotes Online</span>
            <span className="text-sm font-mono text-zinc-200">
              {remotesOnline}/{telemetry?.remotes.length ?? "—"}
            </span>
            {remotesUnreachable > 0 && (
              <span className="text-[10px] text-red-400/70 font-mono">
                {remotesUnreachable} down
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03]">
            <Globe size={14} className="text-teal-mystic" />
            <span className="text-xs text-zinc-400 flex-1">Models</span>
            <span className="text-sm font-mono text-zinc-200">
              {ollamaCount !== null ? `${ollamaCount}` : "—"}
            </span>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03]">
            <Activity size={14} className="text-teal-mystic" />
            <span className="text-xs text-zinc-400 flex-1">Gateway</span>
            <span className="text-sm font-mono text-zinc-200 text-jade-glow">
              {gwStatus === "ok" ? "Online" : gwStatus || "—"}
            </span>
          </div>

          <div className="pt-2 mt-3 border-t border-white/[0.04]">
            <div className="flex items-center gap-2 text-[10px] text-zinc-600 font-mono">
              <Sparkles size={10} />
              Awaiting orchestration
            </div>
          </div>
        </div>
      )}

      {/* PROCESSING STATE — trace active */}
      {!noTrace && (phase === "replaying" || (traceActive && phase !== "complete")) && trace && currentStage && (
        <div className="space-y-3">
          {/* Current stage */}
          <div className="p-3 rounded-xl bg-teal-mystic/[0.06] border border-teal-mystic/[0.12]">
            <div className="text-[10px] font-semibold tracking-widest uppercase text-teal-mystic/60 mb-1">
              Current Stage
            </div>
            <div className="text-sm font-medium text-teal-mystic">{currentStage.label}</div>
            <div className="mt-1 text-[10px] text-zinc-500 leading-tight">{stageDesc(currentStage.label)}</div>
            {currentStage.label === "Intent Classification" && Array.isArray(currentStage.metadata?.intent_probs) && (
              <ForkInTheRoad intents={currentStage.metadata.intent_probs as IntentProb[]} />
            )}
            {currentStage.label === "Response Generation" && (
              <div className="mt-3">
                <TokenVelocity step={currentStage} isReplay={phase === "replaying"} />
              </div>
            )}
            {(currentStage.metadata?.output as string | undefined) && (
              <div className="mt-2 text-[11px] text-zinc-400 font-mono leading-relaxed line-clamp-2">
                {highlightKeyWords(currentStage.metadata.output as string, trace?.prompt || "")}
              </div>
            )}
            {currentStage.context_assembled && (
              <div className="mt-3 space-y-2">
                <button
                  onClick={() => setShowContext(!showContext)}
                  className="text-[9px] font-mono tracking-wider text-teal-mystic/50 hover:text-teal-mystic/80 transition-colors"
                >
                  {showContext ? "▾ Hide context assembly" : "▸ Show context assembly"}
                </button>
                {showContext && (
                  <ContextAssemblyBreakdown
                    step={currentStage}
                    systemPrompt={getSystemPrompt(
                      trace?.steps.find((s) => s.label === "Response Generation") ?? null
                    )}
                    userPrompt={trace?.prompt}
                  />
                )}
              </div>
            )}
          </div>

          {/* Next stage */}
          {nextStageLabel && (
            <div className="p-3 rounded-xl bg-white/[0.03]">
              <div className="text-[10px] font-semibold tracking-widest uppercase text-zinc-600 mb-1">
                Next
              </div>
              <div className="text-sm text-zinc-300">{nextStageLabel}</div>
            </div>
          )}

          {/* Elapsed time */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03]">
            <Clock size={14} className="text-solar-gold" />
            <span className="text-xs text-zinc-400 flex-1">Elapsed</span>
            <span className="text-sm font-mono text-zinc-200">
              {totalDuration > 0
                ? totalDuration > 1000
                  ? `${(totalDuration / 1000).toFixed(1)}s`
                  : `${totalDuration}ms`
                : "…"}
            </span>
          </div>

          {/* Agent activity indicators */}
          <div className="pt-2 mt-3 border-t border-white/[0.04] space-y-2">
            <div className="text-[10px] font-semibold tracking-widest uppercase text-zinc-600">
              Agents
            </div>
            <div className="flex gap-1.5">
              {STAGES.map((stage, i) => {
                const isCurrent = i === activeStepIndex;
                const isDone = activeStepIndex !== null && i < activeStepIndex;
                return (
                  <div
                    key={i}
                    title={`${stage.label}: ${stage.desc}`}
                    className={`w-2 h-2 rounded-full transition-all duration-300 ${
                      isCurrent
                        ? "bg-solar-gold shadow-[0_0_4px_rgba(251,191,36,0.5)]"
                        : isDone
                          ? "bg-jade-glow"
                          : "bg-white/[0.05]"
                    }`}
                  />
                );
              })}
            </div>
          </div>

          {/* Thought stream toggle */}
          {thoughtEntries.length > 0 && (
            <button
              onClick={() => setShowThoughtStream(!showThoughtStream)}
              className="w-full text-[9px] font-mono tracking-wider text-zinc-600 hover:text-zinc-400 transition-colors pt-1"
            >
              {showThoughtStream ? "▾ Hide thought stream" : "▸ Show thought stream"}
            </button>
          )}
          {showThoughtStream && thoughtEntries.length > 0 && (
            <ThoughtStream entries={thoughtEntries} />
          )}
        </div>
      )}

      {/* COMPLETED STATE */}
      {!noTrace && phase === "complete" && trace && (
        <div className="space-y-3">
          <div className="p-3 rounded-xl bg-solar-gold/[0.06] border border-solar-gold/[0.12]">
            <div className="flex items-center gap-2 text-solar-gold mb-2">
              <CheckCircle size={14} />
              <span className="text-[10px] font-semibold tracking-widest uppercase">Complete</span>
            </div>

            {trace.output && (
              <div className="mt-2 text-[11px] text-zinc-300 font-mono leading-relaxed line-clamp-3">
                {trace.output}
              </div>
            )}
          </div>

          <TraceRadar trace={trace} />

          <HallucinationGauge trace={trace} />

          {/* Confidence — radiant solar ring */}
          {confidence !== null && (
            <div className="flex justify-center py-2">
              <svg width="80" height="80" viewBox="0 0 80 80">
                <ConfidenceRing confidence={confidence} cx={40} cy={40} r={28} />
              </svg>
            </div>
          )}

          {/* Stage Debate — cognitive dissonance detection */}
          {(() => {
            const csStep = trace.steps.find((s) => s.label === "Context Assembly");
            const rgStep = trace.steps.find((s) => s.label === "Response Generation");
            const csOut = csStep?.metadata?.output as string | undefined;
            const rgOut = rgStep?.metadata?.output as string | undefined;
            if (!csOut || !rgOut) return null;
            return <StageDebate step5Output={csOut} step6Output={rgOut} />;
          })()}

          {/* Trace Root Cause */}
          {rootCauseIdx === null ? (
            <button
              onClick={() => {
                const result = findRootCause(trace);
                if (result) setRootCauseIdx(result.index);
              }}
              className="w-full p-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[9px] font-mono tracking-wider text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 transition-all"
            >
              Trace root cause
            </button>
          ) : (
            <div className="p-3 rounded-xl bg-amber-500/[0.06] border border-amber-500/[0.15]">
              <div className="flex items-center gap-2 text-amber-400 mb-1">
                <Activity size={11} />
                <span className="text-[9px] font-semibold tracking-widest uppercase">Likely Culprit</span>
              </div>
              <div className="text-[11px] font-mono text-amber-300">
                Stage {rootCauseIdx + 1}: {trace.steps[rootCauseIdx]?.label}
              </div>
              <div className="text-[10px] text-zinc-400 mt-0.5">{findRootCause(trace)?.reason}</div>
            </div>
          )}

          <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03]">
            <Clock size={14} className="text-zinc-500" />
            <span className="text-xs text-zinc-400 flex-1">Duration</span>
            <span className="text-sm font-mono text-zinc-200">
              {totalDuration > 1000
                ? `${(totalDuration / 1000).toFixed(1)}s`
                : `${totalDuration}ms`}
            </span>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03]">
            <Brain size={14} className="text-zinc-500" />
            <span className="text-xs text-zinc-400 flex-1">Model</span>
            <span className="text-xs font-mono text-zinc-400">{trace.model_used || "qwen2.5:3b"}</span>
          </div>

          {/* Token velocity — precise from eval_count */}
          {trace.steps.find((s) => s.label === "Response Generation") && (
            <TokenVelocity
              step={trace.steps.find((s) => s.label === "Response Generation")!}
              isReplay={true}
            />
          )}

          {/* Per-stage token breakdown */}
          {trace.steps.some((s) => s.eval_count != null) && (
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05] space-y-2">
              <div className="text-[9px] font-semibold tracking-widest uppercase text-zinc-500">Per-Stage Tokens</div>
              {trace.steps.map((s, i) => {
                if (s.eval_count == null) return null;
                const tokS = s.eval_duration_ns ? (s.eval_count / (s.eval_duration_ns / 1e9)).toFixed(1) : "—";
                const dur = s.duration_ms ? (s.duration_ms > 1000 ? `${(s.duration_ms / 1000).toFixed(1)}s` : `${s.duration_ms}ms`) : "—";
                return (
                  <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
                    <span className="text-zinc-500 w-28 truncate">{s.label}</span>
                    <span className="text-purple-400 w-20">{s.eval_count} tok</span>
                    <span className="text-zinc-500 w-16">{tokS} t/s</span>
                    <span className="text-zinc-600 w-16">{dur}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Attribution — telemetry impact */}
          {trace.telemetry_impact && (
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05] space-y-2">
              <div className="text-[9px] font-semibold tracking-widest uppercase text-zinc-600 flex items-center gap-1.5">
                <Cpu size={10} />
                Attribution — Resource Impact
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[8px] font-mono text-zinc-600">Peak CPU</div>
                  <div className="text-[11px] font-mono text-zinc-300">{trace.telemetry_impact.peak_cpu}%</div>
                </div>
                <div>
                  <div className="text-[8px] font-mono text-zinc-600">Peak RAM</div>
                  <div className="text-[11px] font-mono text-zinc-300">{trace.telemetry_impact.peak_mem}%</div>
                </div>
                <div>
                  <div className="text-[8px] font-mono text-zinc-600">Avg CPU</div>
                  <div className="text-[11px] font-mono text-zinc-300">{trace.telemetry_impact.avg_cpu}%</div>
                </div>
                <div>
                  <div className="text-[8px] font-mono text-zinc-600">Avg RAM</div>
                  <div className="text-[11px] font-mono text-zinc-300">{trace.telemetry_impact.avg_mem}%</div>
                </div>
              </div>
            </div>
          )}

          {/* Memory Retrieval chunks */}
          {(() => {
            const mrStep = trace.steps.find((s) => s.label === "Memory Retrieval");
            const chunks = mrStep?.metadata?.retrieved_chunks as RetrievedChunk[] | undefined;
            const vg = mrStep?.metadata?.vector_graph as { points: VectorPoint[]; edges: VectorEdge[] } | undefined;
            if (!chunks) return null;
            return (
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05] space-y-2">
                <ChunkDisplay chunks={chunks} />
                {/* Confidence Filter Gauge */}
                {(() => {
                  const total = chunks.length;
                  const used = chunks.filter((c) => c.used).length;
                  const pct = total > 0 ? used / total : 0;
                  const R = 16;
                  const circ = 2 * Math.PI * R;
                  return (
                    <div className="flex items-center gap-3 py-1">
                      <svg width="44" height="44" viewBox="0 0 44 44">
                        <circle cx="22" cy="22" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
                        <circle
                          cx="22" cy="22" r={R}
                          fill="none"
                          stroke={pct < 0.5 ? "oklch(55% 0.22 30)" : "oklch(65% 0.18 145)"}
                          strokeWidth="5"
                          strokeDasharray={circ}
                          strokeDashoffset={circ * (1 - pct)}
                          strokeLinecap="round"
                          transform="rotate(-90 22 22)"
                          style={{ transition: "stroke-dashoffset 0.5s" }}
                        />
                        <text x="22" y="22" textAnchor="middle" dominantBaseline="central"
                          fill="oklch(72% 0.11 75)" fontSize="11" fontFamily="monospace"
                        >
                          {used}
                        </text>
                      </svg>
                      <div className="flex flex-col">
                        <span className="text-[8px] font-mono tracking-wider text-zinc-600 uppercase">
                          Confidence Filter
                        </span>
                        <span className="text-[9px] font-mono text-zinc-400">
                          {used}/{total} relevant{(pct < 0.5 && total > 0) ? " — low confidence" : ""}
                        </span>
                      </div>
                    </div>
                  );
                })()}
                {vg && <VectorDistanceGraph points={vg.points} edges={vg.edges} />}
              </div>
            );
          })()}

          {/* Synthesis Bridge */}
          <SynthesisBridge trace={trace} />

          {/* Insight tags */}
          {insightTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {insightTags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded-full text-[9px] font-mono uppercase tracking-wider
                    bg-solar-gold/[0.08] text-solar-gold border border-solar-gold/[0.15]"
                >
                  {tag.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          )}

          {/* Response rationale */}
          {trace.response_rationale && (
            <div className="p-3 rounded-xl bg-violet-glow/[0.06] border border-violet-glow/[0.12]">
              <div className="flex items-center gap-1.5 text-violet-glow/70 mb-1.5">
                <Brain size={11} />
                <span className="text-[9px] font-semibold tracking-widest uppercase">Why this response?</span>
              </div>
              <div className="text-[10px] text-zinc-400 font-mono leading-relaxed whitespace-pre-wrap">
                {trace.response_rationale}
              </div>
            </div>
          )}

          {/* Trace explanation */}
          {trace.trace_explanation && (
            <div className="p-3 rounded-xl bg-teal-mystic/[0.06] border border-teal-mystic/[0.12]">
              <div className="flex items-center gap-1.5 text-teal-mystic/70 mb-1.5">
                <Activity size={11} />
                <span className="text-[9px] font-semibold tracking-widest uppercase">Trace explanation</span>
              </div>
              <div className="text-[10px] text-zinc-400 font-mono leading-relaxed whitespace-pre-wrap">
                {trace.trace_explanation}
              </div>
            </div>
          )}

          {/* Mythic Layer — named phenomena from live telemetry */}
          <MythicLayer trace={trace} />

          {/* Dual-Timeline Workspace */}
          <DualTimeline trace={trace} />

          {/* Assembled Context Breakdown (uses Response Generation step — that's where the model payload is assembled) */}
          {(() => {
            const rgStep = trace.steps.find((s) => s.label === "Response Generation");
            if (!rgStep?.context_assembled) return null;
            return (
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05] space-y-2">
                <button
                  onClick={() => setShowReplayContext(showReplayContext === "rg" ? null : "rg")}
                  className="w-full flex items-center justify-between text-[9px] font-semibold tracking-widest uppercase text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <span>Assembled Context</span>
                  <span className="text-zinc-600">{showReplayContext === "rg" ? "▾" : "▸"}</span>
                </button>
                {showReplayContext === "rg" && (
                  <ContextAssemblyBreakdown
                    step={rgStep}
                    systemPrompt={getSystemPrompt(rgStep)}
                    userPrompt={trace.prompt}
                  />
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
