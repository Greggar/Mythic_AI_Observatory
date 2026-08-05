"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";
import { Play, Square } from "lucide-react";
import type { TraceSession } from "@/types/trace";

interface Props {
  exchanges: TraceSession[];
  onSelectExchange: (traceId: string) => void;
  playing: boolean;
  current: number | null;
  onPlay: () => void;
  onStop: () => void;
}

interface Pt {
  id: string;
  ex: number;
  intent: string;
  time: string;
  model: string | null;
  mean: number | null;
}

const INTENT_COLORS = [
  "#2dd4bf", "#a78bfa", "#fbbf24", "#60a5fa",
  "#f472b6", "#fb923c", "#34d399", "#c084fc",
];

function extractIntent(t: TraceSession): string {
  const step = t.steps?.find((s) => s.label === "Intent Classification");
  const probs = step?.metadata?.intent_probs;
  if (Array.isArray(probs) && probs.length > 0 && probs[0]) {
    return String((probs[0] as { label?: string }).label ?? "");
  }
  return "";
}

export default function ChatTimeline({ exchanges, onSelectExchange, playing, current, onPlay, onStop }: Props) {
  const { pts, intentColor } = useMemo(() => {
    const sorted = [...exchanges]
      .filter((t) => t.status === "complete")
      .sort((a, b) => (a.exchange_index ?? 0) - (b.exchange_index ?? 0));

    const colorOf = new Map<string, string>();
    let next = 0;
    const p: Pt[] = sorted.map((t) => {
      const intent = extractIntent(t);
      if (!colorOf.has(intent)) colorOf.set(intent, INTENT_COLORS[next++ % INTENT_COLORS.length]);
      return {
        id: t.id,
        ex: t.exchange_index ?? 0,
        intent,
        time: t.created_at?.slice(11, 19) ?? "",
        model: t.model_used,
        mean: t.token_entropy?.mean_entropy ?? null,
      };
    });
    return { pts: p, intentColor: colorOf };
  }, [exchanges]);

  if (pts.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="glass-panel p-4"
    >
      <div className="flex items-center justify-between px-0.5 mb-3">
        <span className="text-[9px] font-mono tracking-wider text-zinc-600 uppercase">
          Chat Timeline
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-zinc-600">
            {playing ? `replaying EX${pts[current ?? 0].ex}…` : `${pts.length} exchanges`}
          </span>
          <button
            onClick={playing ? onStop : onPlay}
            disabled={pts.length < 2}
            className={`flex items-center gap-1 text-[9px] font-mono px-2 py-1 rounded-full border transition-colors ${
              playing
                ? "border-red-400/30 text-red-400 hover:border-red-400/50"
                : "border-teal-mystic/30 text-teal-mystic hover:border-teal-mystic/50"
            } disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            {playing ? <Square className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
            {playing ? "stop" : "replay session"}
          </button>
        </div>
      </div>

      <div className="relative px-1">
        {/* Rail */}
        <div className="absolute left-0 right-0 top-[7px] h-0.5 rounded bg-white/[0.06]" />

        {/* Nodes */}
        <div className="relative flex items-start justify-between">
          {pts.map((p, i) => {
            const dimmed = playing && current !== null && current !== i;
            return (
              <div key={p.id} className="flex flex-col items-center gap-1.5 z-10">
                <button
                  onClick={() => {
                    onStop();
                    onSelectExchange(p.id);
                  }}
                  className="group"
                  title={`EX${p.ex} · ${p.model || "—"}`}
                >
                  <span
                    className={`block rounded-full transition-all ${
                      current === i
                        ? "w-3.5 h-3.5 ring-2 ring-white/30"
                        : "w-2.5 h-2.5 group-hover:ring-2 group-hover:ring-white/25"
                    }`}
                    style={{
                      backgroundColor: intentColor.get(p.intent) ?? "#2dd4bf",
                      opacity: dimmed ? 0.3 : 1,
                    }}
                  />
                </button>
                <div className="flex flex-col items-center leading-tight">
                  <span
                    className={`text-[8px] font-mono ${current === i ? "text-zinc-300" : "text-zinc-600"}`}
                  >
                    EX{p.ex}
                  </span>
                  <span className="text-[8px] font-mono text-zinc-700">{p.time}</span>
                  {p.mean != null && (
                    <span
                      className={`text-[8px] font-mono ${
                        p.mean >= 0.05 ? "text-red-400/70" : p.mean >= 0.02 ? "text-solar-gold/70" : "text-teal-mystic/70"
                      }`}
                    >
                      H {p.mean.toFixed(3)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {pts.length < 2 && (
        <div className="text-[10px] font-mono text-zinc-600 px-0.5 mt-2">
          Send a second exchange to enable session replay.
        </div>
      )}
    </motion.div>
  );
}
