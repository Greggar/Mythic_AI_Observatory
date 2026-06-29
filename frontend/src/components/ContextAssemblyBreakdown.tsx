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

function TinyTokenBadge({ tokens }: { tokens: number }) {
  return (
    <span className="text-[8px] font-mono text-zinc-600">
      <span className="text-zinc-500">{tokens}</span> tok
    </span>
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
  userPrompt?: string;
  maxTokens?: number;
}

export default function ContextAssemblyBreakdown({
  step,
  systemPrompt,
  userPrompt,
  maxTokens = 4096,
}: Props) {
  const rawContext = step.context_assembled || "";

  // Split assembled context into "previous stage output" vs "user input"
  let assembledPart = rawContext;
  let inputPart = "";

  if (userPrompt && rawContext.endsWith(userPrompt)) {
    const splitAt = rawContext.length - userPrompt.length;
    assembledPart = rawContext.slice(0, splitAt).replace(/\n$/, "");
    inputPart = userPrompt;
  } else if (userPrompt) {
    // Try last occurrence of user prompt
    const idx = rawContext.lastIndexOf(userPrompt);
    if (idx !== -1) {
      assembledPart = rawContext.slice(0, idx).replace(/\n$/, "");
      inputPart = rawContext.slice(idx);
    }
  }

  const sysTokens = estimateTokens(systemPrompt || "");
  const ctxTokens = estimateTokens(assembledPart);
  const inpTokens = estimateTokens(inputPart);
  const totalTokens = estimateTokens(rawContext);

  return (
    <div className="space-y-3">
      <TokenMeter used={totalTokens} max={maxTokens} />
      <div className="grid grid-cols-3 gap-px bg-white/[0.06] rounded-lg overflow-hidden">
        {/* System Prompt */}
        <div className="bg-black/20 p-2.5 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[8px] font-semibold tracking-widest uppercase text-zinc-500">
              System
            </span>
            <TinyTokenBadge tokens={sysTokens} />
          </div>
          <div className="text-[9px] text-zinc-400 font-mono leading-relaxed whitespace-pre-wrap break-words max-h-32 overflow-y-auto scrollbar-thin flex-1">
            {systemPrompt ? (
              <span className="text-zinc-300">{systemPrompt}</span>
            ) : (
              <span className="text-zinc-600 italic">(none)</span>
            )}
          </div>
        </div>

        {/* Assembled Context */}
        <div className="bg-black/30 p-2.5 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[8px] font-semibold tracking-widest uppercase text-zinc-500">
              Context
            </span>
            <TinyTokenBadge tokens={ctxTokens} />
          </div>
          <div className="text-[9px] font-mono leading-relaxed whitespace-pre-wrap break-words max-h-32 overflow-y-auto scrollbar-thin flex-1">
            {assembledPart ? renderContextLines(assembledPart) : (
              <span className="text-zinc-600 italic">(no context assembled)</span>
            )}
          </div>
        </div>

        {/* User Input */}
        <div className="bg-black/20 p-2.5 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[8px] font-semibold tracking-widest uppercase text-zinc-500">
              Input
            </span>
            <TinyTokenBadge tokens={inpTokens} />
          </div>
          <div className="text-[9px] text-zinc-400 font-mono leading-relaxed whitespace-pre-wrap break-words max-h-32 overflow-y-auto scrollbar-thin flex-1">
            {inputPart || (
              <span className="text-zinc-600 italic">(no input)</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
