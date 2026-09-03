"use client";

import { useMemo } from "react";
import type { TraceStep } from "@/types/trace";

interface TokenPoint {
  label: string;
  tok_s: number;
  eval_count: number;
}

interface Props {
  steps: TraceStep[];
}

export default function TokenVelocityGraph({ steps }: Props) {
  const points = useMemo<TokenPoint[]>(() => {
    return steps
      .filter((s) => s.model_used != null && s.eval_count != null && s.eval_duration_ns != null && s.eval_duration_ns > 0)
      .map((s) => ({
        label: s.label,
        tok_s: s.eval_count! / (s.eval_duration_ns! / 1e9),
        eval_count: s.eval_count!,
      }));
  }, [steps]);

  const maxTokS = Math.max(...points.map((p) => p.tok_s), 1);
  const W = 220;
  const H = 56;
  const pad = 2;

  const path = useMemo(() => {
    if (points.length < 2) return "";
    const pts = points.map((p, i) => ({
      x: pad + (i / (points.length - 1)) * (W - pad * 2),
      y: H - pad - (p.tok_s / maxTokS) * (H - pad * 2),
    }));
    let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
    for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i - 1].x + pts[i].x) / 2;
      const my = (pts[i - 1].y + pts[i].y) / 2;
      d += ` Q ${pts[i - 1].x.toFixed(2)} ${pts[i - 1].y.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
    }
    d += ` L ${pts[pts.length - 1].x.toFixed(2)} ${pts[pts.length - 1].y.toFixed(2)}`;
    return d;
  }, [points, maxTokS]);

  if (points.length < 1) return null;

  const latest = points[points.length - 1];
  const latestTokS = latest.tok_s.toFixed(1);

  return (
    <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-semibold tracking-widest uppercase text-purple-400/80">
          Token Velocity
        </span>
        <span className="text-[11px] font-mono text-purple-400">
          {latestTokS} tok/s
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-8">
        <path d={path} fill="none" stroke="#a78bfa" strokeWidth="1.5" opacity={0.6} />
        <path d={path} fill="none" stroke="#a78bfa" strokeWidth="0.5" opacity={0.3} />
        {points.map((p, i) => {
          const x = pad + (i / (points.length - 1)) * (W - pad * 2);
          const y = H - pad - (p.tok_s / maxTokS) * (H - pad * 2);
          const isLast = i === points.length - 1;
          return (
            <circle
              key={i}
              cx={x.toFixed(2)}
              cy={y.toFixed(2)}
              r={isLast ? 2.5 : 1.5}
              fill={isLast ? "#a78bfa" : "rgba(167,139,250,0.5)"}
            />
          );
        })}
      </svg>
      <div className="flex justify-between text-[8px] font-mono text-zinc-600 mt-0.5">
        <span>{points[0].label}</span>
        <span>{latest.label}</span>
      </div>
    </div>
  );
}
