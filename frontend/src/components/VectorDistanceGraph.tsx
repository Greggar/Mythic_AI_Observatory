"use client";

import { useMemo, useRef, useState } from "react";

const W = 260;
const H = 200;

interface VectorPoint {
  id: string;
  label: string;
  content?: string;
  relevance?: number;
  used?: boolean;
  is_query: boolean;
}

interface VectorEdge {
  source: string;
  target: string;
  similarity: number;
}

interface Props {
  points: VectorPoint[];
  edges: VectorEdge[];
}

function mds2d(
  points: VectorPoint[],
  edges: VectorEdge[]
): { x: number; y: number; pt: VectorPoint }[] {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: W / 2, y: H / 2, pt: points[0] }];

  const dist: number[][] = Array.from({ length: n }, () => Array(n).fill(1));
  for (let i = 0; i < n; i++) dist[i][i] = 0;

  const idx = new Map(points.map((p, i) => [p.id, i]));
  for (const e of edges) {
    const si = idx.get(e.source);
    const ti = idx.get(e.target);
    if (si !== undefined && ti !== undefined) {
      const d = Math.max(0.05, 1 - e.similarity);
      dist[si][ti] = d;
      dist[ti][si] = d;
    }
  }

  const dSq = dist.map((row) => row.map((d) => d * d));
  const rowMeans = dSq.map((row) => row.reduce((a, b) => a + b, 0) / n);
  const colMeans = dSq[0].map((_, ci) => dSq.reduce((s, row) => s + row[ci], 0) / n);
  const grandMean = rowMeans.reduce((a, b) => a + b, 0) / n;

  const B = dSq.map((row, ri) =>
    row.map((_, ci) => -0.5 * (row[ci] - rowMeans[ri] - colMeans[ci] + grandMean))
  );

  function dominantEigen(B: number[][]): { val: number; vec: number[] } {
    let vec = Array(n).fill(1).map(() => Math.random() - 0.5);
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    if (norm < 1e-12) return { val: 0, vec: Array(n).fill(0) };
    vec = vec.map((v) => v / norm);
    for (let iter = 0; iter < 100; iter++) {
      const nv = Array(n).fill(0);
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) nv[i] += B[i][j] * vec[j];
      const eig = Math.sqrt(nv.reduce((s, v) => s + v * v, 0));
      if (eig < 1e-12) break;
      vec = nv.map((v) => v / eig);
      return { val: eig, vec };
    }
    return { val: 0, vec: Array(n).fill(0) };
  }

  const Bc = B.map((r) => [...r]);
  const e1 = dominantEigen(Bc);
  const B2 = Bc.map((row, ri) =>
    row.map((_, ci) => Bc[ri][ci] - e1.val * e1.vec[ri] * e1.vec[ci])
  );
  const e2 = dominantEigen(B2);

  const pos = points.map((pt, i) => ({
    x: Math.sqrt(Math.abs(e1.val)) * (e1.vec[i] || 0),
    y: Math.sqrt(Math.abs(e2.val)) * (e2.vec[i] || 0),
    pt,
  }));

  const xs = pos.map((p) => p.x);
  const ys = pos.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 30;
  const s = Math.min(
    (W - pad * 2) / (maxX - minX || 1),
    (H - pad * 2) / (maxY - minY || 1)
  );
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  return pos.map((p) => ({
    x: W / 2 + (p.x - cx) * s,
    y: H / 2 + (p.y - cy) * s,
    pt: p.pt,
  }));
}

export default function VectorDistanceGraph({ points, edges }: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const tooltipRef = useRef<{ x: number; y: number } | null>(null);

  const layout = useMemo(() => mds2d(points, edges), [points, edges]);
  const pointMap = useMemo(
    () => new Map(layout.map((l) => [l.pt.id, l])),
    [layout]
  );

  const maxSim = Math.max(...edges.map((e) => e.similarity), 0.01);

  if (layout.length === 0) return null;

  const hoveredPt = hoveredId ? points.find((p) => p.id === hoveredId) : null;

  return (
    <div className="relative">
      <div className="text-[8px] font-mono tracking-wider text-zinc-600 uppercase mb-1">
        Vector Graph
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto rounded-lg"
          style={{ background: "rgba(255,255,255,0.02)" }}
          onMouseLeave={() => setHoveredId(null)}
        >
          {/* Edges */}
          {edges.map((e, i) => {
            const src = pointMap.get(e.source);
            const tgt = pointMap.get(e.target);
            if (!src || !tgt) return null;
            const opacity = 0.1 + 0.6 * (e.similarity / maxSim);
            const dim = hoveredId !== null &&
              hoveredId !== e.source && hoveredId !== e.target;
            return (
              <line
                key={i}
                x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                stroke="rgba(45,212,191,0.3)"
                strokeWidth={0.5 + 2 * (e.similarity / maxSim)}
                opacity={dim ? 0.04 : opacity}
              />
            );
          })}

          {/* Nodes */}
          {layout.map((l, li) => {
            const isQuery = l.pt.is_query;
            const isHovered = hoveredId === l.pt.id;
            const r = isQuery ? 6 : 4.5;
            const fill = isQuery
              ? "oklch(72% 0.11 75)"
              : l.pt.used
                ? "oklch(62% 0.16 145)"
                : "oklch(55% 0.1 280)";
            const dim = hoveredId !== null && !isHovered;
            return (
              <g key={`${l.pt.id}-${li}`} style={{ cursor: "pointer" }}>
                <circle cx={l.x} cy={l.y} r={r + 6} fill="transparent"
                  style={{ cursor: "pointer" }}
                  onMouseEnter={(e) => {
                    setHoveredId(l.pt.id);
                    tooltipRef.current = { x: e.clientX, y: e.clientY };
                  }}
                  onMouseMove={(e) => {
                    tooltipRef.current = { x: e.clientX, y: e.clientY };
                  }}
                />
                <circle cx={l.x} cy={l.y} r={r + 1.5} fill="none" stroke={fill}
                  strokeWidth={0.5} opacity={dim ? 0.15 : 0.4} />
                <circle cx={l.x} cy={l.y} r={r} fill={fill}
                  opacity={dim ? 0.15 : 0.85} />
                {isQuery && !dim && (
                  <text x={l.x} y={l.y - r - 4} textAnchor="middle"
                    fill="rgba(45,212,191,0.6)" fontSize="7" fontFamily="monospace">
                    Query
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Tooltip */}
        {hoveredPt && tooltipRef.current && (
          <div
            className="fixed z-50 pointer-events-none"
            style={{
              left: tooltipRef.current.x + 14,
              top: tooltipRef.current.y - 10,
            }}
          >
            <div className="bg-[rgba(6,30,40,0.94)] backdrop-blur-sm border border-teal-mystic/20 rounded-md px-2.5 py-1.5 shadow-lg max-w-[200px]">
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  hoveredPt.is_query ? "bg-[oklch(72%_0.11_75)]" :
                  hoveredPt.used ? "bg-[oklch(62%_0.16_145)]" :
                  "bg-[oklch(55%_0.1_280)]"
                }`} />
                <span className="text-[10px] font-mono text-zinc-200 truncate">
                  {hoveredPt.is_query
                    ? "Current Prompt"
                    : `Trace ${hoveredPt.id.slice(0, 8)}...`}
                </span>
              </div>
              <div className="text-[9px] text-zinc-400 mt-1 leading-tight line-clamp-3">
                {hoveredPt.label}
              </div>
              {!hoveredPt.is_query && (
                <div className="flex items-center gap-2 mt-1.5 text-[8px]">
                  <span className={`font-mono ${
                    hoveredPt.used ? "text-[oklch(62%_0.16_145)]" : "text-zinc-600"
                  }`}>
                    {hoveredPt.used ? "Used" : "Discarded"}
                  </span>
                  <span className="font-mono text-zinc-600">
                    {((hoveredPt.relevance || 0) * 100).toFixed(0)}% match
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
