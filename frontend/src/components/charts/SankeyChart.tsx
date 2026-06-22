"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";

interface SankeyNode {
  id: string;
  label: string;
  column: number;
  value: number;
  color: string;
  x: number;
  y0: number;
  y1: number;
}

interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

interface Props {
  data: SankeyData;
  width?: number;
  height?: number;
}

const COLUMN_NAMES = ["Depth", "Mood", "Syntax", "Action", "Tone", "Form", "DDC"];

export default function SankeyChart({ data, width = 640, height = 420 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<{ label: string; count: number; x: number; y: number } | null>(null);
  const pad = { top: 30, right: 100, bottom: 20, left: 20 };
  const availW = width - pad.left - pad.right;
  const availH = height - pad.top - pad.bottom;
  const colX = (col: number) => pad.left + (col / 6) * availW;

  // Position nodes
  const columnNodes: SankeyNode[][] = Array.from({ length: 7 }, () => []);
  for (const n of data.nodes) columnNodes[n.column].push(n);

  for (let col = 0; col < 7; col++) {
    const cn = columnNodes[col];
    const total = cn.reduce((s, n) => s + n.value, 0) || 1;
    let yOff = pad.top;
    for (const n of cn) {
      const h = Math.max((n.value / total) * availH, 2);
      n.x = colX(col);
      n.y0 = yOff;
      n.y1 = yOff + h;
      yOff += h + 4;
    }
  }

  const nodeMap = new Map(data.nodes.map(n => [n.id, n]));

  // Build link paths
  const linkPaths: { d: string; color: string; label: string; count: number; value: number }[] = [];
  for (const link of data.links) {
    const src = nodeMap.get(link.source);
    const tgt = nodeMap.get(link.target);
    if (!src || !tgt) continue;
    const sx = src.x + (colX(1) - colX(0));
    const tx = tgt.x;
    const sy = (src.y0 + src.y1) / 2;
    const ty = (tgt.y0 + tgt.y1) / 2;
    const cp = (tx - sx) * 0.5;
    const w = Math.max(link.value / 2, 1);
    const d = `M ${sx} ${sy - w} C ${sx + cp} ${sy - w} ${tx - cp} ${ty - w} ${tx} ${ty - w} L ${tx} ${ty + w} C ${tx - cp} ${ty + w} ${sx + cp} ${sy + w} ${sx} ${sy + w} Z`;
    linkPaths.push({ d, color: src.color, label: `${src.label} → ${tgt.label}`, count: link.value, value: link.value });
  }

  const totalTraces = data.nodes.reduce((s, n) => s + n.value, 0);

  return (
    <div ref={ref} className="relative rounded-lg overflow-hidden" style={{ background: "linear-gradient(180deg, #041824 0%, #0a2d38 50%, #06303d 100%)" }}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="sankey-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(45,212,191,0.04)" />
            <stop offset="100%" stopColor="rgba(45,212,191,0)" />
          </radialGradient>
          <linearGradient id="taper-fade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="white" stopOpacity="0" />
            <stop offset="100%" stopColor="white" stopOpacity="0.12" />
          </linearGradient>
        </defs>
        <rect x={0} y={0} width={width} height={height} rx={8} fill="url(#sankey-glow)" />

        {/* Column headers */}
        {COLUMN_NAMES.map((name, col) => (
          <text key={`hdr-${col}`} x={colX(col) + 45} y={14} textAnchor="middle" fill="rgba(161,161,170,0.6)" fontSize="8" fontFamily="monospace">
            {name}
          </text>
        ))}

        {/* Links (behind nodes) */}
        {linkPaths.map((l, i) => (
          <path key={`link-${i}`} d={l.d} fill={l.color} opacity={0.2} stroke={l.color} strokeWidth={0.3}
            style={{ cursor: "pointer", transition: "opacity 0.15s" }}
            onMouseEnter={(e) => setHovered({ label: l.label, count: l.count, x: e.clientX, y: e.clientY })}
            onMouseMove={(e) => setHovered(h => h ? { ...h, x: e.clientX, y: e.clientY } : null)}
            onMouseLeave={() => setHovered(null)}
          />
        ))}

        {/* Nodes */}
        {data.nodes.map(n => {
          const h = n.y1 - n.y0;
          const nw = colX(1) - colX(0);
          const taper = 0.6;
          const mid = (n.y0 + n.y1) / 2;
          const tH = h * taper;
          const nodePath = `M ${n.x} ${n.y0} L ${n.x + nw} ${mid - tH / 2} L ${n.x + nw} ${mid + tH / 2} L ${n.x} ${n.y1} Z`;
          return (
            <g key={n.id} style={{ cursor: "pointer" }}
              onMouseEnter={(e) => setHovered({ label: n.label, count: n.value, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => setHovered(h => h ? { ...h, x: e.clientX, y: e.clientY } : null)}
              onMouseLeave={() => setHovered(null)}
            >
              <path d={nodePath} fill={n.color} opacity={0.65} stroke="rgba(0,0,0,0.3)" strokeWidth={0.3} />
              <path d={nodePath} fill="url(#taper-fade)" pointerEvents="none" />
              {h > 12 && (
                <text x={n.x + 4} y={mid + 3} fill="rgba(255,255,255,0.85)" fontSize="6" fontFamily="monospace" style={{ pointerEvents: "none" }}>
                  {n.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Total */}
        <text x={width - 8} y={height - 6} textAnchor="end" fill="rgba(45,212,191,0.3)" fontSize="7" fontFamily="monospace">
          {totalTraces} traces
        </text>
      </svg>

      {hovered && typeof document !== "undefined" && createPortal(
        <div className="fixed z-[100] pointer-events-none" style={{ left: Math.min(hovered.x + 12, window.innerWidth - 200), top: hovered.y + 12 }}>
          <div className="bg-[rgba(6,30,40,0.92)] backdrop-blur-sm border border-teal-mystic/20 rounded-md px-2.5 py-1.5 shadow-lg max-w-[180px]">
            <p className="text-[10px] leading-tight text-teal-mystic/80 font-medium">{hovered.label}</p>
            <p className="text-[8px] text-zinc-500 mt-0.5">{hovered.count} trace{hovered.count !== 1 ? "s" : ""} ({totalTraces > 0 ? Math.round(hovered.count / totalTraces * 100) : 0}%)</p>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
