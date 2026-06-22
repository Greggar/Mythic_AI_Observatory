"use client";

import { useState, useEffect, useRef } from "react";
import { Activity, Zap } from "lucide-react";
import type { TraceStep } from "@/types/trace";

interface Props {
  step: TraceStep;
  isReplay?: boolean;
}

export default function TokenVelocity({ step, isReplay }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [animTokS, setAnimTokS] = useState(0);
  const frameRef = useRef<number>(0);
  const animStartRef = useRef<number>(0);

  const genStartedAt = step.metadata?.gen_started_at as string | undefined;
  const hasEval = step.eval_count != null && step.eval_duration_ns != null && step.eval_duration_ns > 0;
  const tokS = hasEval ? step.eval_count! / (step.eval_duration_ns! / 1e9) : 0;

  const isProcessing = step.status === "processing" || step.status === "pending";

  useEffect(() => {
    if (isProcessing && genStartedAt) {
      const startMs = new Date(genStartedAt).getTime();
      const tick = () => {
        setElapsed(Date.now() - startMs);
        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frameRef.current);
    }
  }, [isProcessing, genStartedAt]);

  useEffect(() => {
    if (!isProcessing && hasEval && isReplay) {
      animStartRef.current = performance.now();
      const dur = Math.max(step.duration_ms || 1000, 600);
      const tick = (now: number) => {
        const t = Math.min((now - animStartRef.current) / dur, 1);
        setAnimTokS(tokS * easeOutCubic(t));
        if (t < 1) frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frameRef.current);
    }
  }, [isProcessing, hasEval, isReplay, tokS, step.duration_ms]);

  if (isProcessing) {
    const secs = (elapsed / 1000).toFixed(1);
    return (
      <div className="p-3 rounded-xl bg-purple-500/[0.04] border border-purple-500/[0.08]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] font-semibold tracking-widest uppercase text-purple-400/80">
            Token Velocity
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Activity size={12} className="text-purple-400 animate-pulse" />
          <span className="text-[11px] text-purple-300/70">Generating…</span>
        </div>
        <div className="mt-1 font-mono text-[10px] text-zinc-500">{secs}s elapsed</div>
      </div>
    );
  }

  if (!hasEval) return null;

  const displayTokS = isReplay ? animTokS : tokS;

  return (
    <div className="p-3 rounded-xl bg-purple-500/[0.04] border border-purple-500/[0.08]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] font-semibold tracking-widest uppercase text-purple-400/80">
          Token Velocity
        </span>
        <span className="text-[11px] font-mono text-purple-400">
          {displayTokS.toFixed(1)} tok/s
        </span>
      </div>
      <MiniBar value={displayTokS} max={Math.max(tokS * 1.5, 10)} />
      <div className="flex items-center gap-1 mt-1 text-[9px] text-zinc-600">
        <Zap size={9} />
        <span>
          {step.eval_count} tokens in {(step.eval_duration_ns! / 1e9).toFixed(1)}s
        </span>
      </div>
    </div>
  );
}

function MiniBar({ value, max }: { value: number; max: number }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="w-full h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
      <div
        className="h-full rounded-full bg-gradient-to-r from-purple-500/60 to-violet-400/80 transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
