"use client";
import { X } from "lucide-react";
import TraceRadar from "@/components/TraceRadar";
import type { TraceSession } from "@/types/trace";

interface Props {
  traces: TraceSession[];
  onClose: () => void;
}

const TRACE_COLORS = [
  "#34d399",
  "#a78bfa",
  "#fbbf24",
  "#60a5fa",
  "#f472b6",
  "#fb923c",
];

export default function ComparativeRadarPanel({ traces, onClose }: Props) {
  if (traces.length < 2) return null;

  return (
    <div className="glass-panel p-4 space-y-3 relative">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-semibold tracking-widest uppercase text-violet-400">
            Fingerprint Comparison
          </span>
          <span className="text-[8px] font-mono text-zinc-600">
            {traces.length} traces
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-600 hover:text-zinc-400 transition-colors p-1 -mr-1 -mt-1"
          title="Close comparison"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Trace list header */}
      <div className="space-y-1">
        {traces.map((t, ti) => {
          const color = TRACE_COLORS[ti % TRACE_COLORS.length];
          const shortId = t.id.length > 12 ? t.id.slice(0, 12) + "…" : t.id;
          const model = t.model_used?.split(":")[0] || "?";
          const date = new Date(t.created_at).toLocaleString(undefined, {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
          });
          return (
            <div key={t.id} className="flex items-center gap-2 text-[9px] font-mono">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
              <span className="text-zinc-300 truncate max-w-[100px]" title={t.id}>{shortId}</span>
              <span className="text-zinc-500">{model}</span>
              <span className="text-zinc-600 ml-auto">{date}</span>
            </div>
          );
        })}
      </div>

      {/* Radar chart */}
      <TraceRadar traces={traces} />

      {/* Prompt and output comparison */}
      <div className="space-y-2 max-h-[300px] overflow-y-auto">
        {traces.map((t, ti) => {
          const color = TRACE_COLORS[ti % TRACE_COLORS.length];
          return (
            <details key={t.id} className="group">
              <summary className="flex items-center gap-2 text-[9px] font-mono cursor-pointer text-zinc-500 hover:text-zinc-300 transition-colors">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className="truncate">{t.prompt.slice(0, 60)}</span>
              </summary>
              <div className="mt-1.5 ml-4 space-y-1.5">
                <div className="text-[9px] text-zinc-400">
                  <span className="text-zinc-600">Prompt: </span>
                  {t.prompt}
                </div>
                <div className="text-[9px] text-zinc-400">
                  <span className="text-zinc-600">Output: </span>
                  {(t.output || "").replace(/\[.*?\]:\s*/g, "").slice(0, 200)}
                </div>
                {t.ddc?.prompt && (
                  <div className="text-[8px] text-teal-mystic/60">
                    DDC: {t.ddc.prompt.code} {t.ddc.prompt.label}
                  </div>
                )}
                {t.lcc?.prompt && (
                  <div className="text-[8px] text-purple-400/60">
                    LCC: {t.lcc.prompt.code} {t.lcc.prompt.label}
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
