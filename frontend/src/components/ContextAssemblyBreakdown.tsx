"use client";

import type { TraceStep } from "@/types/trace";

function estimateTokens(text: string): number {
  return Math.round(text.length / 4);
}

function TokenMeter({ used, max }: { used: number; max: number }) {
  const pct = Math.min(used / max, 1);
  const color =
    pct > 0.8 ? "#ef4444"
    : pct > 0.5 ? "#f59e0b"
    : "#34d399";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[9px] font-mono">
        <span className="text-zinc-500">Token Budget</span>
        <span className="text-zinc-400">
          <span style={{ color }}>{used}</span>
          <span className="text-zinc-600"> / {max}</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct * 100}%`,
            backgroundColor: color,
            boxShadow: pct > 0.8 ? `0 0 6px ${color}` : "none",
          }}
        />
      </div>
      {pct > 0.8 && (
        <div className="text-[8px] font-mono text-red-400/70">
          Context window nearing capacity
        </div>
      )}
    </div>
  );
}

function renderContextLines(text: string): React.ReactNode[] {
  return text.split("\n").map((line, i) => {
    const match = line.match(/^\[([^\]]+)\]:\s*(.*)/);
    if (match) {
      return (
        <div key={i} className="leading-relaxed">
          <span className="text-teal-mystic/70">[{match[1]}]</span>
          <span className="text-zinc-500">: {match[2]}</span>
        </div>
      );
    }
    return <div key={i} className="text-zinc-400 leading-relaxed">{line}</div>;
  });
}

interface Props {
  step: TraceStep;
  systemPrompt: string | null;
  maxTokens?: number;
}

export default function ContextAssemblyBreakdown({
  step,
  systemPrompt,
  maxTokens = 4096,
}: Props) {
  const usedTokens = step.context_assembled ? estimateTokens(step.context_assembled) : 0;

  return (
    <div className="space-y-3">
      <TokenMeter used={usedTokens} max={maxTokens} />
      <div className="grid grid-cols-2 gap-0 relative">
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/[0.06]" />
        <div className="pr-3">
          <div className="text-[8px] font-semibold tracking-widest uppercase text-zinc-600 mb-1.5">
            System Instructions
          </div>
          <div className="text-[9px] text-zinc-400 font-mono leading-relaxed whitespace-pre-wrap break-words max-h-32 overflow-y-auto scrollbar-thin bg-white/[0.02] rounded px-1.5 py-1">
            {systemPrompt || "(no system prompt for this stage)"}
          </div>
        </div>
        <div className="pl-3">
          <div className="text-[8px] font-semibold tracking-widest uppercase text-zinc-600 mb-1.5">
            Injected Context
          </div>
          <div className="text-[9px] font-mono leading-relaxed whitespace-pre-wrap break-words max-h-32 overflow-y-auto scrollbar-thin bg-white/[0.02] rounded px-1.5 py-1">
            {step.context_assembled ? renderContextLines(step.context_assembled) : (
              <span className="text-zinc-600">(no context assembled)</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
