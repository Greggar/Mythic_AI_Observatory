"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
const W = 280;
const H = 280;
const CX = W / 2;
const CY = H / 2;

interface HistoryEntry {
  id: string;
  prompt: string;
  status: string;
  created_at: string;
  output: string | null;
  steps: { duration_ms: number | null }[];
}

interface Props {
  onSelect: (traceId: string) => void;
  refreshTrigger: number;
}

function computeSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).slice(0, 15));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).slice(0, 15));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let common = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) common++;
  }
  return common / Math.max(wordsA.size + wordsB.size - common, 1);
}

function extractTheme(entries: HistoryEntry[]): string {
  const freq = new Map<string, number>();
  const stopwords = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "been",
    "this", "that", "these", "those", "to", "of", "in", "for", "on", "with",
    "what", "how", "why", "when", "where", "do", "does", "did", "will", "would",
    "can", "could", "should", "may", "might", "shall", "has", "have", "had",
    "not", "no", "nor", "but", "or", "and", "if", "then", "else", "so",
    "about", "into", "over", "after", "before", "between", "through",
    "during", "without", "within", "along", "among", "please", "tell",
    "explain", "describe", "list", "show", "give", "make", "create",
    "write", "find", "need", "want", "like", "just", "also", "very",
    "much", "many", "some", "any", "each", "every", "all", "both",
    "i", "me", "my", "you", "your", "it", "its", "we", "our", "they",
    "them", "their", "he", "she", "him", "her", "his"]);
  for (const e of entries) {
    for (const w of e.prompt.toLowerCase().split(/\W+/)) {
      if (w.length > 2 && !stopwords.has(w)) {
        freq.set(w, (freq.get(w) || 0) + 1);
      }
    }
  }
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return "Misc";
  if (sorted.length === 1) return sorted[0][0];
  return sorted.slice(0, 2).map(([w]) => w).join(" / ");
}

function clusterEntries(entries: HistoryEntry[]): HistoryEntry[][] {
  if (entries.length === 0) return [];
  const n = entries.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (computeSimilarity(entries[i].prompt, entries[j].prompt) > 0.15) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }
  const visited = new Set<number>();
  const groups: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (visited.has(i)) continue;
    const stack = [i];
    const group: number[] = [];
    while (stack.length > 0) {
      const idx = stack.pop()!;
      if (visited.has(idx)) continue;
      visited.add(idx);
      group.push(idx);
      for (const nb of adj[idx]) {
        if (!visited.has(nb)) stack.push(nb);
      }
    }
    groups.push(group);
  }
  return groups
    .map((g) => g.map((i) => entries[i]).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()))
    .sort((a, b) => b.length - a.length);
}

interface ClusterLayout {
  label: string;
  cx: number;
  cy: number;
  dots: { x: number; y: number; r: number; entry: HistoryEntry }[];
  connections: [number, number][];
}

function layoutGalaxy(clusters: HistoryEntry[][]): ClusterLayout[] {
  const n = clusters.length;
  if (n === 0) return [];

  return clusters.map((entries, ci) => {
    const t = n > 1 ? ci / (n - 1) : 0;
    const angle = t * Math.PI * 2.5 - Math.PI / 2;
    const radius = 20 + t * 85;
    const ccx = CX + radius * Math.cos(angle);
    const ccy = CY + radius * Math.sin(angle);

    const dotCount = entries.length;
    const spread = Math.min(10 + dotCount * 5, 35);
    const dots = entries.map((entry, ei) => {
      const da = (ei / dotCount) * Math.PI * 2;
      return {
        x: ccx + spread * Math.cos(da),
        y: ccy + spread * Math.sin(da),
        r: Math.max(3.5, 6 - dotCount * 0.12),
        entry,
      };
    });

    const connections: [number, number][] = [];
    for (let i = 0; i < dotCount; i++) {
      for (let j = i + 1; j < dotCount; j++) {
        const s = computeSimilarity(entries[i].prompt, entries[j].prompt);
        if (s > 0.2) connections.push([i, j]);
      }
    }

    return {
      label: extractTheme(entries),
      cx: ccx,
      cy: ccy,
      dots,
      connections,
    };
  });
}

function galaxySpiralPath(): string {
  const pts = 50;
  let d = "";
  for (let i = 0; i <= pts; i++) {
    const t = i / pts;
    const theta = t * Math.PI * 2.5 - Math.PI / 2;
    const r = 20 + t * 85;
    const x = CX + r * Math.cos(theta);
    const y = CY + r * Math.sin(theta);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(4)} ${y.toFixed(4)}`;
  }
  return d;
}

export default function MemoryConstellation({ onSelect, refreshTrigger }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const prevCount = useRef(0);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE}/api/traces?limit=40`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setEntries((prev) => {
            if (data.length > prev.length) {
              const prevIds = new Set(prev.map((e) => e.id));
              const fresh = new Set<string>((data as HistoryEntry[]).filter((e) => !prevIds.has(e.id)).map((e) => e.id));
              if (fresh.size > 0) setNewIds(fresh);
            }
            return data;
          });
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshTrigger]);

  const clusters = useMemo(() => clusterEntries(entries), [entries]);
  const galaxy = useMemo(() => layoutGalaxy(clusters), [clusters]);

  return (
    <div className="glass-panel p-4 space-y-3">
      <div className="flex flex-col items-center gap-1.5 text-teal-mystic">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 2a10 10 0 1010 10" />
          <path d="M12 2v10l6 6" opacity="0.6" />
          <circle cx="12" cy="12" r="2" opacity="0.4" />
        </svg>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
            Memory Retrieval
          </span>
          {loading && (
            <motion.span
              className="inline-block w-1.5 h-1.5 rounded-full bg-teal-mystic"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
          )}
        </div>
      </div>

      <div
        className="relative overflow-hidden rounded-lg"
        style={{ background: "linear-gradient(180deg, #041824 0%, #0a2d38 50%, #06303d 100%)" }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
          <defs>
            <radialGradient id="galaxy-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(45,212,191,0.05)" />
              <stop offset="100%" stopColor="rgba(45,212,191,0)" />
            </radialGradient>
          </defs>
          <rect x={0} y={0} width={W} height={H} rx={8} fill="url(#galaxy-glow)" />

          {galaxy.length === 0 && !loading && (
            <text x={CX} y={CY} textAnchor="middle"
              fill="rgba(82,82,91,0.6)" fontSize="10" fontFamily="monospace">
              No traces yet
            </text>
          )}

          {galaxy.length > 0 && (
            <g>
              {/* Spiral arm backbone */}
              <path d={galaxySpiralPath()} fill="none" stroke="rgba(45,212,191,0.08)" strokeWidth={1} />
              <path d={galaxySpiralPath()} fill="none" stroke="rgba(45,212,191,0.06)" strokeWidth={0.7}
                transform={`rotate(140 ${CX} ${CY})`} />
              <path d={galaxySpiralPath()} fill="none" stroke="rgba(45,212,191,0.04)" strokeWidth={0.5}
                transform={`rotate(260 ${CX} ${CY})`} />

              {/* Slow galaxy rotation */}
              <g>
                <animateTransform attributeName="transform" type="rotate"
                  from={`0 ${CX} ${CY}`} to={`360 ${CX} ${CY}`}
                  dur="120s" repeatCount="indefinite" />

                {/* Connection filaments within clusters */}
                {galaxy.map((cl, ci) =>
                  cl.connections.map(([i, j]) => {
                    const a = cl.dots[i];
                    const b = cl.dots[j];
                    return (
                      <motion.line
                        key={`c-${ci}-${i}`}
                        x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                        stroke="rgba(45,212,191,0.12)" strokeWidth={0.4}
                        initial={{ opacity: 0 }}
                        animate={mounted ? { opacity: 0.4 } : {}}
                        transition={{ duration: 0.8, delay: ci * 0.1 }}
                      />
                    );
                  })
                )}

                {/* Dots */}
                {galaxy.map((cl, ci) =>
                  cl.dots.map((dot, ei) => {
                    const isNew = newIds.has(dot.entry.id);
                    return (
                      <motion.g
                        key={dot.entry.id}
                        onClick={() => {
                          setNewIds((prev) => { const c = new Set(prev); c.delete(dot.entry.id); return c; });
                          onSelect(dot.entry.id);
                        }}
                        style={{ cursor: "pointer" }}
                        initial={{ opacity: 0, scale: 0 }}
                        animate={mounted ? { opacity: 1, scale: 1 } : {}}
                        transition={{ duration: 0.5, delay: ci * 0.08 + ei * 0.03 }}
                        whileHover={{ scale: 1.8 }}
                      >
                        {isNew && (
                          <motion.circle
                            cx={dot.x} cy={dot.y} r={dot.r}
                            fill="none" stroke="#f59e0b" strokeWidth={1.5}
                            initial={{ scale: 0.5, opacity: 0.9 }}
                            animate={{ scale: [0.5, 3.5], opacity: [0.9, 0] }}
                            transition={{ duration: 5, ease: "easeOut" }}
                            onAnimationComplete={() =>
                              setNewIds((prev) => { const c = new Set(prev); c.delete(dot.entry.id); return c; })
                            }
                          />
                        )}
                        {isNew && (
                          <motion.circle
                            cx={dot.x} cy={dot.y} r={dot.r * 0.6}
                            fill="#f59e0b"
                            initial={{ opacity: 1 }}
                            animate={{ opacity: [1, 0.4, 1] }}
                            transition={{ duration: 1.2, repeat: 3, ease: "easeInOut" }}
                          />
                        )}
                        <circle cx={dot.x} cy={dot.y} r={dot.r + 3} fill="rgba(45,212,191,0.05)" />
                        <circle cx={dot.x} cy={dot.y} r={dot.r} fill="none" stroke="rgba(45,212,191,0.4)" strokeWidth={0.7} />
                        <circle cx={dot.x} cy={dot.y} r={dot.r * 0.55} fill="#2dd4bf" />
                        <title>{dot.entry.prompt}</title>
                      </motion.g>
                    );
                  })
                )}
              </g>

              {/* Labels (outside rotation so they stay readable) */}
              {galaxy.map((cl, ci) => {
                const t = galaxy.length > 1 ? ci / (galaxy.length - 1) : 0;
                const angle = t * Math.PI * 2.5 - Math.PI / 2;
                const r = 20 + t * 85;
                const labelR = r + 18;
                const lx = CX + labelR * Math.cos(angle);
                const ly = CY + labelR * Math.sin(angle);
                return (
                  <text key={`l-${ci}`} x={lx} y={ly + 2} textAnchor="middle"
                    fill="rgba(45,212,191,0.35)" fontSize="6.5" fontFamily="monospace"
                    letterSpacing="0.06em">
                    {cl.label}
                  </text>
                );
              })}
            </g>
          )}

          {/* Core glow */}
          <circle cx={CX} cy={CY} r={18} fill="rgba(45,212,191,0.04)" />
          <circle cx={CX} cy={CY} r={2} fill="rgba(45,212,191,0.15)" />
        </svg>
      </div>
    </div>
  );
}
