"use client";

import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { arc as d3Arc, chord as d3Chord, Chord } from "d3";
import { createPortal } from "react-dom";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
const W = 420;
const H = 420;
const CX = W / 2;
const CY = H / 2;
const RIM = 125;
const LABEL_R = 152;
const INNER = 40;
const GAP = 0.03;
const PAD_ANGLE = 0.04;

const INPUT_COLORS = ["#60a5fa", "#34d399", "#fbbf24", "#f472b6"];
const OUTPUT_COLORS = ["#a78bfa", "#fb923c", "#f87171", "#2dd4bf"];

const INPUT_LABELS = ["Short prompt", "Question", "Technical", "Creative"];
const OUTPUT_LABELS = ["Verbose reply", "Uses bullets", "Uses code", "Hedged tone"];

const ALL_LABELS = [...INPUT_LABELS, ...OUTPUT_LABELS];
const NODE_COLORS = [...INPUT_COLORS, ...OUTPUT_COLORS];
const N = ALL_LABELS.length;

interface TraceData {
  id: string;
  prompt: string;
  output: string | null;
  ddc?: { prompt?: { code?: string } | null } | null;
}

function polar(cx: number, cy: number, r: number, a: number): [number, number] {
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function hedgeDensity(text: string): number {
  const hedgeWords = /\b(I cannot|generally|perhaps|maybe|might|suggests|appears|seems|could be|tend to|usually|often|typically|i think|i believe|in my opinion|it depends)\b/gi;
  const matches = (text.match(hedgeWords) || []).length;
  return matches / Math.max(text.split(/\s+/).length, 1);
}

function computeInputTraits(t: TraceData): number[] {
  const out = [0, 0, 0, 0];
  const len = t.prompt.length;
  if (len < 80) out[0] = 1;
  if (t.prompt.trim().endsWith("?")) out[1] = 1;
  const code = t.ddc?.prompt?.code;
  if (code) {
    const d = code[0];
    if (d === "0" || d === "5" || d === "6") out[2] = 1;
    else if (d === "7" || d === "8") out[3] = 1;
  }
  return out;
}

function computeOutputTraits(t: TraceData): number[] {
  const out = [0, 0, 0, 0];
  const text = t.output || "";
  if (!text) return out;
  if (text.length > 600) out[0] = 1;
  if (/^[-*]\s/m.test(text)) out[1] = 1;
  if (/```/.test(text)) out[2] = 1;
  if (hedgeDensity(text) > 0.02) out[3] = 1;
  return out;
}

function buildMatrix(traces: TraceData[]): number[][] {
  const M = Array.from({ length: N }, () => Array(N).fill(0));
  for (const t of traces) {
    const input = computeInputTraits(t);
    const output = computeOutputTraits(t);
    for (let i = 0; i < 4; i++) {
      if (!input[i]) continue;
      for (let j = 0; j < 4; j++) {
        if (!output[j]) continue;
        M[i][4 + j] += 1;
        M[4 + j][i] += 1;
      }
    }
  }
  return M;
}

const safe = (a: number) => (isNaN(a) || !isFinite(a) ? 0 : a);
const arcGen = d3Arc();
const chordLayout = d3Chord().padAngle(PAD_ANGLE).sortGroups(null);

interface Props {
  refreshTrigger?: number;
}

export default function RelationshipsPanel({ refreshTrigger = 0 }: Props) {
  const [traces, setTraces] = useState<TraceData[]>([]);
  const [hoveredChord, setHoveredChord] = useState<{ source: number; target: number; count: number; sx: number; sy: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchTraces = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/traces?limit=200`);
      if (!res.ok) return;
      const data = await res.json();
      setTraces(data as TraceData[]);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchTraces();
  }, [fetchTraces, refreshTrigger]);

  const chords = useMemo(() => {
    const M = buildMatrix(traces);
    const c = chordLayout(M);
    return c;
  }, [traces]);

  if (traces.length < 3) {
    return (
      <div className="glass-panel p-4 space-y-3">
        <div className="flex flex-col items-center gap-1.5 text-teal-mystic">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="5" cy="6" r="2.5" />
            <circle cx="19" cy="6" r="2.5" />
            <circle cx="12" cy="18" r="2.5" />
            <path d="M5 6l7 12" opacity="0.4" />
            <path d="M19 6l-7 12" opacity="0.4" />
            <path d="M7.5 6h9" opacity="0.2" />
          </svg>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
              Relationships
            </span>
          </div>
        </div>
        <div className="relative rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(180deg, #041824 0%, #0a2d38 50%, #06303d 100%)", minHeight: "120px" }}>
          <span className="text-[10px] font-mono text-zinc-600">Need at least 3 traces</span>
        </div>
      </div>
    );
  }

  const chordRows = chords?.filter((c) => c.source.value > 0) ?? [];
  const groups = chords?.groups ?? [];
  const hasData = groups.length > 0;

  return (
    <div className="glass-panel p-4 space-y-3">
      <div className="flex flex-col items-center gap-1.5 text-teal-mystic">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="5" cy="6" r="2.5" />
          <circle cx="19" cy="6" r="2.5" />
          <circle cx="12" cy="18" r="2.5" />
          <path d="M5 6l7 12" opacity="0.4" />
          <path d="M19 6l-7 12" opacity="0.4" />
          <path d="M7.5 6h9" opacity="0.2" />
        </svg>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
            Relationships — Cognitive Synesthesia
          </span>
        </div>
      </div>

      <div ref={containerRef} className="relative rounded-lg overflow-hidden" style={{ background: "linear-gradient(180deg, #041824 0%, #0a2d38 50%, #06303d 100%)" }}>
        {!hasData && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10px] font-mono text-zinc-600">No relationships found</span>
          </div>
        )}
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          <defs>
            <radialGradient id="chord-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(45,212,191,0.05)" />
              <stop offset="100%" stopColor="rgba(45,212,191,0)" />
            </radialGradient>
          </defs>
          <rect x={0} y={0} width={W} height={H} rx={8} fill="url(#chord-glow)" />

          <g transform={`translate(${CX}, ${CY})`}>
            {/* Arc segments (chord groups) */}
            {(groups as any[]).map((g: any, i: number) => {
              if (g.value === 0) return null;
              const color = NODE_COLORS[i] || "#374151";
              const p = arcGen({
                innerRadius: INNER,
                outerRadius: RIM,
                startAngle: safe(g.startAngle),
                endAngle: safe(g.endAngle),
              });
              return (
                <path key={`group-${i}`} d={p || ""} fill={color} opacity={0.6} stroke="rgba(0,0,0,0.3)" strokeWidth={0.5} />
              );
            })}

            {/* Labels */}
            {(groups as any[]).map((g: any, i: number) => {
              if (g.value === 0) return null;
              const mid = (g.startAngle + g.endAngle) / 2;
              const [lx, ly] = polar(0, 0, LABEL_R, mid);
              const flip = mid > Math.PI / 2 && mid < (3 * Math.PI) / 2;
              return (
                <text
                  key={`label-${i}`}
                  x={lx}
                  y={ly}
                  textAnchor={flip ? "end" : "start"}
                  fill="rgba(161,161,170,0.7)"
                  fontSize="7"
                  fontFamily="monospace"
                  transform={flip ? `rotate(${(mid * 180) / Math.PI + 180}, ${lx}, ${ly})` : `rotate(${(mid * 180) / Math.PI}, ${lx}, ${ly})`}
                  style={{ pointerEvents: "none" }}
                >
                  {ALL_LABELS[i]}
                </text>
              );
            })}

            {/* Ribbons */}
            {chordRows.map((c: Chord, idx: number) => {
              const src = c.source;
              const tgt = c.target;
              const color = NODE_COLORS[src.index] || "#374151";
              // build ribbon path manually
              const sr0 = INNER, sr1 = RIM;
              const tr0 = INNER, tr1 = RIM;

              const p0 = polar(0, 0, sr1, src.endAngle);
              const p1 = polar(0, 0, sr1, src.startAngle);
              const p2 = polar(0, 0, tr1, tgt.startAngle);
              const p3 = polar(0, 0, tr1, tgt.endAngle);

              const rCP = RIM * 0.25;
              const cp0 = polar(0, 0, rCP, src.endAngle);
              const cp1 = polar(0, 0, rCP, tgt.startAngle);
              const cp2 = polar(0, 0, rCP, src.startAngle);
              const cp3 = polar(0, 0, rCP, tgt.endAngle);

              const d = [
                `M ${p0[0]},${p0[1]}`,
                `C ${cp0[0]},${cp0[1]} ${cp1[0]},${cp1[1]} ${p2[0]},${p2[1]}`,
                `A ${tr1} ${tr1} 0 0 1 ${p3[0]},${p3[1]}`,
                `C ${cp3[0]},${cp3[1]} ${cp2[0]},${cp2[1]} ${p1[0]},${p1[1]}`,
                `A ${sr1} ${sr1} 0 0 1 ${p0[0]},${p0[1]}`,
                `Z`,
              ].join(" ");

              return (
                <path
                  key={`ribbon-${idx}`}
                  d={d}
                  fill={color}
                  opacity={0.25}
                  stroke={color}
                  strokeWidth={0.3}
                  style={{ cursor: "pointer", transition: "opacity 0.15s" }}
                  onMouseEnter={(e) => {
                    const rect = containerRef.current?.getBoundingClientRect();
                    if (rect) {
                      setHoveredChord({
                        source: src.index,
                        target: tgt.index,
                        count: c.source.value,
                        sx: e.clientX - rect.left,
                        sy: e.clientY - rect.top,
                      });
                    }
                  }}
                  onMouseMove={(e) => {
                    const rect = containerRef.current?.getBoundingClientRect();
                    if (rect && hoveredChord) {
                      setHoveredChord({ ...hoveredChord, sx: e.clientX - rect.left, sy: e.clientY - rect.top });
                    }
                  }}
                  onMouseLeave={() => setHoveredChord(null)}
                />
              );
            })}

            {/* Center ring */}
            <circle cx={0} cy={0} r={INNER - 4} fill="rgba(6,30,40,0.85)" stroke="rgba(45,212,191,0.08)" strokeWidth={0.5} />
            <text x={0} y={-3} textAnchor="middle" fill="rgba(45,212,191,0.5)" fontSize="9" fontFamily="monospace">
              {traces.length}
            </text>
            <text x={0} y={8} textAnchor="middle" fill="rgba(45,212,191,0.25)" fontSize="6" fontFamily="monospace">
              traces
            </text>
          </g>
        </svg>

        {/* Input/Output legend */}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          <span className="text-[7px] font-mono tracking-wider text-zinc-600">INPUT →</span>
          {INPUT_LABELS.map((l, i) => (
            <div key={`il-${i}`} className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: INPUT_COLORS[i] }} />
              <span className="text-[7px] font-mono text-zinc-500">{l}</span>
            </div>
          ))}
        </div>
        <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
          <span className="text-[7px] font-mono tracking-wider text-zinc-600">OUTPUT</span>
          {OUTPUT_LABELS.map((l, i) => (
            <div key={`ol-${i}`} className="flex items-center gap-1.5">
              <span className="text-[7px] font-mono text-zinc-500">{l}</span>
              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: OUTPUT_COLORS[i] }} />
            </div>
          ))}
        </div>
      </div>

      {typeof document !== "undefined" && hoveredChord && createPortal(
        (() => {
          const gap = 8;
          const rect = containerRef.current?.getBoundingClientRect();
          if (!rect) return null;
          const sx = rect.left + hoveredChord.sx;
          const sy = rect.top + hoveredChord.sy;
          const tw = 190;
          const onRight = sx > window.innerWidth / 2;
          const left = onRight ? sx - tw - gap : sx + gap;
          const top = sy + gap;
          return (
            <div className="fixed z-[100] pointer-events-none" style={{ left, top }}>
              <div className="bg-[rgba(6,30,40,0.92)] backdrop-blur-sm border border-teal-mystic/20 rounded-md px-2.5 py-1.5 shadow-lg max-w-[190px]">
                <p className="text-[10px] leading-tight text-teal-mystic/80 font-medium">
                  {ALL_LABELS[hoveredChord.source]}
                  <span className="text-zinc-500 mx-1">→</span>
                  {ALL_LABELS[hoveredChord.target]}
                </p>
                <p className="text-[9px] text-zinc-400 mt-0.5">
                  {hoveredChord.count} trace{hoveredChord.count !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
          );
        })(),
        document.body
      )}
    </div>
  );
}
