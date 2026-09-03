"use client";

import { TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Telemetry } from "@/hooks/useWebSocket";

interface Props {
  telemetry: Telemetry | null;
}

const MAX_HISTORY = 60;

export default function TrendChart({ telemetry }: Props) {
  const [history, setHistory] = useState<{ cpu: number; mem: number; gpu: number }[]>([]);

  useEffect(() => {
    if (!telemetry) return;
    setHistory((prev) => {
      const next = [
        ...prev,
        {
          cpu: telemetry.cpu.percent,
          mem: telemetry.memory.percent,
          gpu: telemetry.gpu.gpu_util,
        },
      ];
      if (next.length > MAX_HISTORY) return next.slice(-MAX_HISTORY);
      return next;
    });
  }, [telemetry]);

  const W = 240;
  const H = 60;
  const pad = 2;

  const path = useMemo(() => {
    if (history.length < 2) return "";
    const pts = history.map((p, i) => ({
      x: pad + (i / (history.length - 1)) * (W - pad * 2),
      y: H - pad - (p.cpu / 100) * (H - pad * 2),
    }));
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i - 1].x + pts[i].x) / 2;
      const my = (pts[i - 1].y + pts[i].y) / 2;
      d += ` Q ${pts[i - 1].x} ${pts[i - 1].y} ${mx} ${my}`;
    }
    d += ` L ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;
    return d;
  }, [history]);

  const memPath = useMemo(() => {
    if (history.length < 2) return "";
    const pts = history.map((p, i) => ({
      x: pad + (i / (history.length - 1)) * (W - pad * 2),
      y: H - pad - (p.mem / 100) * (H - pad * 2),
    }));
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i - 1].x + pts[i].x) / 2;
      const my = (pts[i - 1].y + pts[i].y) / 2;
      d += ` Q ${pts[i - 1].x} ${pts[i - 1].y} ${mx} ${my}`;
    }
    d += ` L ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;
    return d;
  }, [history]);

  if (history.length < 2) return null;

  return (
    <div className="glass-panel p-5 space-y-4">
      <div className="flex flex-col items-center gap-1.5">
        <TrendingUp size={16} className="text-[oklch(72%_0.11_75)]" />
        <h1 className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
          Trends
        </h1>
      </div>

      <div className="space-y-3">
        {/* CPU trend */}
        <div>
          <div className="flex justify-between text-[10px] font-mono mb-1">
            <span className="text-zinc-500">CPU</span>
            <span className="text-solar-gold">{history[history.length - 1].cpu.toFixed(1)}%</span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-8">
            <path d={path} fill="none" stroke="#f59e0b" strokeWidth="1.5" opacity={0.6} />
            <path d={path} fill="none" stroke="#f59e0b" strokeWidth="0.5" opacity={0.3} />
          </svg>
        </div>

        {/* Memory trend */}
        <div>
          <div className="flex justify-between text-[10px] font-mono mb-1">
            <span className="text-zinc-500">Memory</span>
            <span className="text-teal-mystic">{history[history.length - 1].mem.toFixed(1)}%</span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-8">
            <path d={memPath} fill="none" stroke="#2dd4bf" strokeWidth="1.5" opacity={0.6} />
            <path d={memPath} fill="none" stroke="#2dd4bf" strokeWidth="0.5" opacity={0.3} />
          </svg>
        </div>
      </div>
    </div>
  );
}
