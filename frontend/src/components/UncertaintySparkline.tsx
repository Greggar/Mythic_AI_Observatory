"use client";

import { useMemo } from "react";
import type { TokenEntropy } from "@/types/trace";

interface Props {
  entropy: TokenEntropy;
}

const W = 200;
const H = 36;
const PAD = 2;

export default function UncertaintySparkline({ entropy }: Props) {
  const { path, area, meanY, hasSeries } = useMemo(() => {
    const series = Array.isArray(entropy.series) && entropy.series.length >= 2
      ? entropy.series
      : null;
    if (!series) {
      return { path: "", area: "", meanY: 0, hasSeries: false };
    }
    const maxVal = Math.max(...series);
    const minVal = Math.min(...series);
    const span = maxVal - minVal || 1;
    const plotW = W - PAD * 2;
    const plotH = H - PAD * 2;
    const pts = series.map((v, i) => {
      const x = PAD + (i / (series.length - 1)) * plotW;
      const y = PAD + plotH - ((v - minVal) / span) * plotH;
      return { x, y };
    });
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
    const areaD = `${d} L${pts[pts.length - 1].x.toFixed(2)},${H - PAD} L${pts[0].x.toFixed(2)},${H - PAD} Z`;
    const meanY = PAD + plotH - ((entropy.mean_entropy ?? minVal) - minVal) / span * plotH;
    return { path: d, area: areaD, meanY, hasSeries: true };
  }, [entropy]);

  if (!hasSeries) {
    return (
      <div className="text-[10px] font-mono text-zinc-600">
        mean {entropy.mean_entropy?.toFixed(2) ?? "—"} bits
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5">
      <svg width={W} height={H} className="shrink-0">
        <defs>
          <linearGradient id="entropy-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#entropy-fill)" />
        <path
          d={path}
          fill="none"
          stroke="#a78bfa"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <line
          x1={PAD}
          x2={W - PAD}
          y1={meanY}
          y2={meanY}
          stroke="#a78bfa"
          strokeOpacity="0.5"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      </svg>
      <div className="text-[10px] font-mono text-zinc-400 leading-tight">
        <div>
          <span className="text-violet-400">mean</span> {entropy.mean_entropy?.toFixed(2)} bits
        </div>
        <div>
          <span className="text-zinc-500">p95</span> {entropy.p95_entropy?.toFixed(2)} bits
        </div>
        <div>
          <span className="text-zinc-500">uncertain</span> {entropy.high_entropy_count}/{entropy.token_count}
        </div>
      </div>
    </div>
  );
}
