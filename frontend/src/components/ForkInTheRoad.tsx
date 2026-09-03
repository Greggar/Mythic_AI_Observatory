"use client";

interface Intent {
  label: string;
  confidence: number;
  reasoning?: string;
}

interface Props {
  intents: Intent[];
}

export default function ForkInTheRoad({ intents }: Props) {
  if (intents.length === 0) return null;

  const chosen = intents[0];
  const alternatives = intents.slice(1);

  return (
    <div className="mt-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.05]">
      <div className="text-[9px] font-semibold tracking-widest uppercase text-zinc-500 mb-2">
        Fork in the Road
      </div>

      {/* Chosen path */}
      <div className="relative pl-5 pb-3 border-l-2 border-teal-mystic/40">
        <div className="absolute -left-[5px] top-0 w-2 h-2 rounded-full bg-teal-mystic shadow-sm shadow-teal-mystic/30" />
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-teal-mystic">{chosen.label}</span>
          <span className="text-[8px] font-mono text-teal-mystic/50">
            {Math.round(chosen.confidence * 100)}%
          </span>
          <span className="ml-auto text-[7px] font-mono tracking-widest uppercase text-teal-mystic/40">
            Selected
          </span>
        </div>
        <div className="flex-1 h-1.5 mt-1 rounded-full bg-white/[0.05] overflow-hidden">
          <div
            className="h-full rounded-full bg-teal-mystic/60"
            style={{ width: `${chosen.confidence * 100}%` }}
          />
        </div>
        {chosen.reasoning && (
          <div className="mt-1 text-[8px] text-zinc-400 leading-relaxed italic">
            &ldquo;{chosen.reasoning}&rdquo;
          </div>
        )}
      </div>

      {/* Rejected paths */}
      {alternatives.map((alt) => (
        <div
          key={alt.label}
          className="relative pl-5 pt-2 pb-2 border-l-2 border-zinc-700/30 ml-0"
        >
          <div className="absolute -left-[5px] top-2 w-2 h-2 rounded-full bg-zinc-600/40" />
          <div className="flex items-center gap-2 opacity-50">
            <span className="text-[10px] font-medium text-zinc-400 line-through decoration-zinc-600">
              {alt.label}
            </span>
            <span className="text-[8px] font-mono text-zinc-600">
              {Math.round(alt.confidence * 100)}%
            </span>
            <span className="ml-auto text-[7px] font-mono tracking-widest uppercase text-zinc-600">
              Rejected
            </span>
          </div>
          <div className="flex-1 h-1 mt-1 rounded-full bg-white/[0.03] overflow-hidden opacity-50">
            <div
              className="h-full rounded-full bg-zinc-600/40"
              style={{ width: `${alt.confidence * 100}%` }}
            />
          </div>
          {alt.reasoning && (
            <div className="mt-0.5 text-[8px] text-zinc-600 leading-relaxed italic">
              &ldquo;{alt.reasoning}&rdquo;
            </div>
          )}
        </div>
      ))}

      {/* Connecting branches hint */}
      <div className="mt-2 flex items-center gap-2 text-[7px] font-mono text-zinc-600/60">
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
        Decision path diverged at intent classification
      </div>
    </div>
  );
}
