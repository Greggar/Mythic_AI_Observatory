"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHover } from "@/lib/HoverContext";
import SunburstChart from "@/components/SunburstChart";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
const W = 280;
const H = 280;
const CX = W / 2;
const CY = H / 2;

const DDC_COLORS: Record<string, string> = {
  "0": "#6b7280", "1": "#a78bfa", "2": "#f87171",
  "3": "#60a5fa", "4": "#34d399", "5": "#fbbf24",
  "6": "#f472b6", "7": "#fb923c", "8": "#818cf8",
  "9": "#2dd4bf",
};

const LCC_COLORS: Record<string, string> = {
  A: "#8b5cf6", B: "#ec4899", C: "#f97316", D: "#eab308",
  G: "#22c55e", H: "#06b6d4", J: "#6366f1", N: "#d946ef",
  P: "#14b8a6", Q: "#f43f5e", R: "#0ea5e9", T: "#a855f7",
  U: "#78716c", V: "#57534e", Z: "#a1a1aa",
};

interface ClassDisplay {
  code: string;
  label: string;
  action: string | null;
  domain: string | null;
  score?: number;
  margin?: number;
  top_scores?: { code: string; label: string; score: number }[];
}

interface HistoryEntry {
  id: string;
  prompt: string;
  status: string;
  created_at: string;
  output: string | null;
  steps: { duration_ms: number | null }[];
  ddc?: { prompt: ClassDisplay | null; response: ClassDisplay | null; prompt_alternatives?: ClassDisplay[]; response_alternatives?: ClassDisplay[] } | null;
  lcc?: { prompt: ClassDisplay | null; response: ClassDisplay | null; prompt_alternatives?: ClassDisplay[]; response_alternatives?: ClassDisplay[] } | null;
}

function entryColor(entry: HistoryEntry, grouping: string): string {
  if (grouping === "lcc") {
    const c = entry.lcc?.prompt?.code?.[0];
    if (c) return LCC_COLORS[c.toUpperCase()] || "#2dd4bf";
    return "#2dd4bf";
  }
  const c = entry.ddc?.prompt?.code?.[0];
  if (c) return DDC_COLORS[c] || "#2dd4bf";
  return "#2dd4bf";
}

interface Annotation {
  id: string;
  trace_id: string;
  content: string;
  tags: string[];
  rating: number | null;
  author: string;
  created_at: string;
}

interface Props {
  onSelect: (traceId: string) => void;
  refreshTrigger: number;
  grouping?: string;
  visualization?: string;
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

function extractTheme(entries: HistoryEntry[], grouping?: string): string {
  if (grouping === "ddc") {
    const first = entries[0];
    const code = first?.ddc?.prompt?.code;
    if (code) {
      const names: Record<string, string> = {
        "0": "General & CS", "1": "Philosophy", "2": "Religion",
        "3": "Social Sciences", "4": "Language", "5": "Science",
        "6": "Technology", "7": "Arts", "8": "Literature", "9": "History & Geo",
      };
      return `${code[0]}00 — ${names[code[0]] || `Class ${code[0]}`}`;
    }
    return "Unclassified";
  }
  if (grouping === "lcc") {
    const first = entries[0];
    const pc = first?.lcc?.prompt?.code;
    const pl = first?.lcc?.prompt?.label;
    if (pc && pl) return `${pc} ${pl}`;
    if (pc) return pc;
    if (pl) return pl;
  }
  if (grouping === "multilabel") {
    const first = entries[0];
    const pc = first?.ddc?.prompt?.code;
    const pl = first?.ddc?.prompt?.label;
    const alts = first?.ddc?.prompt_alternatives;
    let label = pc && pl ? `${pc} ${pl}` : (pc || "Unclassified");
    if (alts && alts.length > 0) {
      label += ` +${alts.map((a) => a.code).join("/")}`;
    }
    return label;
  }
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

function getDDCValue(entry: HistoryEntry, side: "prompt" | "response", field: string): string {
  const ddc = entry.ddc?.[side];
  if (!ddc) return "Unclassified";
  if (field === "domain") return ddc.domain || "Unclassified";
  if (field === "action") return ddc.action || "Unclassified";
  return ddc.code || "Unclassified";
}

function clusterByDDC(entries: HistoryEntry[]): HistoryEntry[][] {
  if (entries.length === 0) return [];
  const groups = new Map<string, HistoryEntry[]>();
  for (const e of entries) {
    const code = e.ddc?.prompt?.code;
    const key = code ? code[0] : "Unclassified";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  return [...groups.values()]
    .map((g) => g.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()))
    .sort((a, b) => b.length - a.length);
}

function clusterByPromptKeywords(entries: HistoryEntry[]): HistoryEntry[][] {
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

function layoutGalaxy(clusters: HistoryEntry[][], grouping?: string): ClusterLayout[] {
  const n = clusters.length;
  if (n === 0) return [];

  const allEntries = clusters.flat();
  const timestamps = allEntries.map((e) => new Date(e.created_at).getTime()).filter((t) => !isNaN(t));
  const maxTs = Math.max(...timestamps);
  const minTs = Math.min(...timestamps);
  const ageRange = maxTs - minTs || 1;

  function dotRadius(entry: HistoryEntry): number {
    const ts = new Date(entry.created_at).getTime();
    if (isNaN(ts)) return 3.5;
    const age = (maxTs - ts) / ageRange;
    return 2.5 + (1 - age) * 3.5;
  }

  return clusters.map((entries, ci) => {
    const armAngle = (ci / n) * Math.PI * 2 - Math.PI / 2;
    const armLength = 115;
    const ccx = CX + armLength * Math.cos(armAngle);
    const ccy = CY + armLength * Math.sin(armAngle);

    const dotCount = entries.length;
    const spread = Math.min(8 + dotCount * 2, 20);
    const dots = entries.map((entry, ei) => {
      const da = (ei / dotCount) * Math.PI * 2;
      return {
        x: ccx + spread * Math.cos(da),
        y: ccy + spread * Math.sin(da),
        r: dotRadius(entry),
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
      label: extractTheme(entries, grouping),
      cx: ccx,
      cy: ccy,
      dots,
      connections,
    };
  });
}

function galaxySpokePaths(clusters: ClusterLayout[]): string[] {
  return clusters.map((cl) => {
    const dx = cl.cx - CX;
    const dy = cl.cy - CY;
    const angle = Math.atan2(dy, dx);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const cpR = dist * 0.6;
    const cpAngle = angle + 0.4;
    const cpX = CX + cpR * Math.cos(cpAngle);
    const cpY = CY + cpR * Math.sin(cpAngle);
    return `M${CX},${CY}Q${cpX.toFixed(2)},${cpY.toFixed(2)} ${cl.cx.toFixed(2)},${cl.cy.toFixed(2)}`;
  });
}

export default function MemoryConstellation({ onSelect, refreshTrigger, grouping = "ddc", visualization = "constellation" }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const prevCount = useRef(0);
  const [hovered, setHovered] = useState<{ entry: HistoryEntry; x: number; y: number } | null>(null);
  const [highlightedCluster, setHighlightedCluster] = useState<number | null>(null);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [annotations, setAnnotations] = useState<Map<string, Annotation[]>>(new Map());
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteTags, setNoteTags] = useState("");
  const [noteRating, setNoteRating] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState("");
  const { hoveredTraceId, setHoveredTraceId } = useHover();

  useEffect(() => setMounted(true), []);

  const fetchAnnotations = useCallback(async (traceId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/traces/${traceId}/annotations`);
      const data: Annotation[] = await res.json();
      setAnnotations((prev) => {
        const next = new Map(prev);
        next.set(traceId, data);
        return next;
      });
    } catch {}
  }, []);

  const clearHover = useCallback(() => {
    setHoveredTraceId(null);
    hoverTimeout.current = setTimeout(() => setHovered(null), 120);
  }, [setHoveredTraceId]);

  const keepHover = useCallback(() => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
  }, []);

  const fetchEntries = useRef(() => {});
  fetchEntries.current = () => {
    fetch(`${API_BASE}/api/traces?limit=40`)
      .then((r) => r.json())
      .then((data) => {
        setEntries((prev) => {
          if (data.length > prev.length) {
            const prevIds = new Set(prev.map((e) => e.id));
            const fresh = new Set<string>((data as HistoryEntry[]).filter((e) => !prevIds.has(e.id)).map((e) => e.id));
            if (fresh.size > 0) setNewIds(fresh);
          }
          return data;
        });
      })
      .catch(() => {});
  };

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

  const filteredEntries = useMemo(
    () => searchQuery ? entries.filter((e) => e.prompt.toLowerCase().includes(searchQuery.toLowerCase())) : entries,
    [entries, searchQuery]
  );

function clusterByLCC(entries: HistoryEntry[]): HistoryEntry[][] {
  if (entries.length === 0) return [];
  const groups = new Map<string, HistoryEntry[]>();
  for (const e of entries) {
    const l = e.lcc?.prompt;
    const key = l?.code ? l.code[0].toUpperCase() : "Unclassified";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  return [...groups.values()]
    .map((g) => g.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()))
    .sort((a, b) => b.length - a.length);
}

function clusterByMultiLabel(entries: HistoryEntry[]): HistoryEntry[][] {
  if (entries.length === 0) return [];
  const groups = new Map<string, HistoryEntry[]>();
  for (const e of entries) {
    const d = e.ddc?.prompt;
    const key = d?.code ? d.code[0] : "Unclassified";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  return [...groups.values()]
    .map((g) => g.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()))
    .sort((a, b) => b.length - a.length);
}

  const clusterFn = useCallback((entries: HistoryEntry[]) => {
    if (grouping === "ddc") return clusterByDDC(entries);
    if (grouping === "lcc") return clusterByLCC(entries);
    if (grouping === "multilabel") return clusterByMultiLabel(entries);
    return clusterByDDC(entries);
  }, [grouping]);

  const layoutFn = useMemo(() => {
    return (clusters: HistoryEntry[][]) => layoutGalaxy(clusters, grouping);
  }, [visualization, grouping]);

  const clusters = useMemo(() => clusterFn(filteredEntries), [filteredEntries, clusterFn]);
  const galaxy = useMemo(() => layoutFn(clusters), [clusters, layoutFn]);

  const handleDelete = async (traceId: string) => {
    setHovered(null);
    await fetch(`${API_BASE}/api/traces/${traceId}`, { method: "DELETE" });
    setEntries((prev) => prev.filter((e) => e.id !== traceId));
  };

  // Delete key removes hovered trace
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && hovered) {
        handleDelete(hovered.entry.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hovered]);

  const handleDotClick = (dotEntry: HistoryEntry) => {
    setNewIds((prev) => { const c = new Set(prev); c.delete(dotEntry.id); return c; });
    setSelectedTraceId(dotEntry.id);
    onSelect(dotEntry.id);
    fetchAnnotations(dotEntry.id);
  };

  const handleAddAnnotation = async () => {
    if (!selectedTraceId || !noteText.trim()) return;
    const tags = noteTags.split(",").map((t) => t.trim()).filter(Boolean);
    try {
      const res = await fetch(`${API_BASE}/api/traces/${selectedTraceId}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: noteText.trim(),
          tags,
          rating: noteRating || null,
          author: "human",
        }),
      });
      if (res.ok) {
        setNoteText("");
        setNoteTags("");
        setNoteRating(0);
        fetchAnnotations(selectedTraceId);
      }
    } catch {}
  };

  const handleDeleteAnnotation = async (annotationId: string) => {
    if (!selectedTraceId) return;
    try {
      await fetch(`${API_BASE}/api/traces/${selectedTraceId}/annotations/${annotationId}`, { method: "DELETE" });
      fetchAnnotations(selectedTraceId);
    } catch {}
  };

  const getAnnotations = (traceId: string) => annotations.get(traceId) || [];

  return (
    <>
    <div
      className="glass-panel p-4 space-y-3"
    >
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

      {/* Search filter */}
      <div className="relative">
        <svg className="absolute left-2 top-1/2 -translate-y-1/2" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter traces..."
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded text-[10px] pl-7 pr-2 py-1.5 text-zinc-400 placeholder-zinc-600 focus:outline-none focus:border-teal-mystic/30"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {visualization === "sunburst" ? (
        <SunburstChart entries={filteredEntries} onSelect={onSelect} grouping={grouping} />
      ) : (
        <>
      <div
        ref={containerRef}
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
          <rect x={0} y={0} width={W} height={H} rx={8} fill="url(#galaxy-glow)"
            onClick={() => setHighlightedCluster(null)} style={{ cursor: highlightedCluster !== null ? "pointer" : undefined }}
          />

          {galaxy.length === 0 && !loading && (
            <text x={CX} y={CY} textAnchor="middle"
              fill="rgba(82,82,91,0.6)" fontSize="10" fontFamily="monospace">
              No traces yet
            </text>
          )}

          {galaxy.length > 0 && (
            <g transform={`translate(${CX}, ${CY}) scale(0.89) translate(${-CX}, ${-CY})`}>
              {/* Curved spokes — one per knowledge domain */}
              {galaxySpokePaths(galaxy).map((d, i) => (
                <path key={`spoke-${i}`} d={d} fill="none" stroke="rgba(45,212,191,0.07)" strokeWidth={0.7} />
              ))}

              {/* Slow galaxy rotation */}
              <g id="rotating-galaxy">
                <animateTransform attributeName="transform" type="rotate"
                  from={`0 ${CX} ${CY}`} to={`360 ${CX} ${CY}`}
                  dur="120s" repeatCount="indefinite" />

                {/* Connection filaments within clusters */}
                {galaxy.map((cl, ci) =>
                  cl.connections.map(([i, j], idx) => {
                    const a = cl.dots[i];
                    const b = cl.dots[j];
                    const dim = hoveredTraceId !== null
                      ? !cl.dots.some(d => d.entry.id === hoveredTraceId)
                      : highlightedCluster !== null && highlightedCluster !== ci;
                    return (
                      <motion.line
                        key={`c-${ci}-${idx}`}
                        x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                        stroke="rgba(45,212,191,0.12)" strokeWidth={0.4}
                        initial={{ opacity: 0 }}
                        animate={mounted ? { opacity: dim ? 0.04 : 0.4 } : {}}
                        transition={{ duration: 0.4 }}
                      />
                    );
                  })
                )}

                {/* Dots */}
                {galaxy.map((cl, ci) =>
                  cl.dots.map((dot, ei) => {
                    const isNew = newIds.has(dot.entry.id);
                    const dim = hoveredTraceId !== null
                      ? hoveredTraceId !== dot.entry.id
                      : highlightedCluster !== null && highlightedCluster !== ci;
                    const dotAnnotations = getAnnotations(dot.entry.id);
                    return (
                      <motion.g
                        key={`${dot.entry.id}-${ci}-${ei}`}
                        onClick={() => handleDotClick(dot.entry)}
                        style={{ cursor: "pointer" }}
                        initial={{ opacity: 0, scale: 0 }}
                        animate={mounted ? { opacity: dim ? 0.15 : 1, scale: 1 } : {}}
                        transition={{ duration: 0.4 }}
                        whileHover={{ scale: dim ? 1 : 1.8 }}
                        onMouseEnter={(e) => {
                          keepHover();
                          setHoveredTraceId(dot.entry.id);
                          const rect = containerRef.current?.getBoundingClientRect();
                          if (rect) {
                            setHovered({ entry: dot.entry, x: e.clientX - rect.left, y: e.clientY - rect.top });
                          }
                        }}
                        onMouseLeave={clearHover}
                      >
                        {isNew && (
                          <motion.circle
                            cx={dot.x} cy={dot.y} r={dot.r}
                            fill="none" stroke={entryColor(dot.entry, grouping)} strokeWidth={1.5}
                            style={{ opacity: 0.5 }}
                            initial={{ scale: 0.5 }}
                            animate={{ scale: [0.5, 3.5], opacity: [0.5, 0] }}
                            transition={{ duration: 5, ease: "easeOut" }}
                            onAnimationComplete={() =>
                              setNewIds((prev) => { const c = new Set(prev); c.delete(dot.entry.id); return c; })
                            }
                          />
                        )}
                        {isNew && (
                          <motion.circle
                            cx={dot.x} cy={dot.y} r={dot.r * 0.6}
                            fill={entryColor(dot.entry, grouping)}
                            style={{ opacity: 0.5 }}
                            initial={{ opacity: 0.5 }}
                            animate={{ opacity: [0.5, 0.2, 0.5] }}
                            transition={{ duration: 1.2, repeat: 3, ease: "easeInOut" }}
                          />
                        )}
                        <circle cx={dot.x} cy={dot.y} r={dot.r + 3} fill={entryColor(dot.entry, grouping)} style={{ opacity: 0.05 }} />
                        <circle cx={dot.x} cy={dot.y} r={dot.r} fill="none" stroke={entryColor(dot.entry, grouping)} style={{ opacity: 0.4 }} strokeWidth={0.7} />
                        <circle cx={dot.x} cy={dot.y} r={dot.r * 0.55} fill={entryColor(dot.entry, grouping)} />
                      </motion.g>
                    );
                  })
                )}

                {/* Labels — counter-rotate to stay upright */}
                {galaxy.map((cl, ci) => {
                  const dx = cl.cx - CX;
                  const dy = cl.cy - CY;
                  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                  const lx = cl.cx + (dx / dist) * 14;
                  const ly = cl.cy + (dy / dist) * 14;
                  return (
                    <g key={`l-${ci}`} onClick={() => setHighlightedCluster(highlightedCluster === ci ? null : ci)}
                      style={{ cursor: "pointer" }}
                      transform={`translate(${lx.toFixed(2)}, ${ly.toFixed(2)})`}>
                      <g>
                        <animateTransform attributeName="transform" type="rotate"
                          from="0" to="-360"
                          dur="120s" repeatCount="indefinite" />
                        <rect x={-30} y={-6} width={60} height={12} rx={4} fill="transparent" />
                        <text x={0} y={2} textAnchor="middle"
                          fill={highlightedCluster === null || highlightedCluster === ci ? "rgba(45,212,191,0.35)" : "rgba(45,212,191,0.08)"}
                          fontSize="6.5" fontFamily="monospace"
                          letterSpacing="0.06em">
                          {cl.label}
                        </text>
                      </g>
                    </g>
                  );
                })}
              </g>
            </g>
          )}

          {/* Core glow */}
          <circle cx={CX} cy={CY} r={18} fill="rgba(45,212,191,0.04)" />
          <circle cx={CX} cy={CY} r={2} fill="rgba(45,212,191,0.15)" />
        </svg>
      </div>

      {/* Annotations section */}
      {selectedTraceId && (
        <div className="border-t border-teal-mystic/10 pt-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono tracking-wider text-teal-mystic/50 uppercase">
              Notes
            </span>
            {annotations.get(selectedTraceId)?.length ? (
              <span className="text-[9px] text-zinc-500">
                {annotations.get(selectedTraceId)!.length}
              </span>
            ) : null}
          </div>

          {/* Existing annotations */}
          {annotations.get(selectedTraceId)?.map((ann) => (
            <div key={ann.id} className="bg-white/[0.03] rounded px-2 py-1.5 relative group">
              <p className="text-[10px] leading-tight text-zinc-300 pr-4">{ann.content}</p>
              <div className="flex items-center gap-2 mt-1">
                {ann.tags.map((tag) => (
                  <span key={tag} className="text-[8px] px-1 py-0.5 rounded bg-teal-mystic/10 text-teal-mystic/60">{tag}</span>
                ))}
                {ann.rating && (
                  <span className="text-[9px] text-solar-gold/60">{ann.rating}/5</span>
                )}
                <span className="text-[8px] text-zinc-600">{ann.author}</span>
              </div>
              <button
                onClick={() => handleDeleteAnnotation(ann.id)}
                className="absolute top-1 right-1 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Delete note"
              >
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}

          {/* Add annotation form */}
          <div className="space-y-1.5">
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Note about this trace..."
              rows={2}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded text-[10px] px-2 py-1 text-zinc-300 placeholder-zinc-600 resize-none focus:outline-none focus:border-teal-mystic/30"
            />
            <div className="flex items-center gap-2">
              <input
                value={noteTags}
                onChange={(e) => setNoteTags(e.target.value)}
                placeholder="tags (comma-separated)"
                className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded text-[9px] px-2 py-1 text-zinc-400 placeholder-zinc-600 focus:outline-none focus:border-teal-mystic/30"
              />
              <select
                value={noteRating}
                onChange={(e) => setNoteRating(Number(e.target.value))}
                className="bg-white/[0.04] border border-white/[0.08] rounded text-[9px] px-1 py-1 text-zinc-400 focus:outline-none focus:border-teal-mystic/30"
              >
                <option value={0}>☆</option>
                <option value={1}>★</option>
                <option value={2}>★★</option>
                <option value={3}>★★★</option>
                <option value={4}>★★★★</option>
                <option value={5}>★★★★★</option>
              </select>
              <button
                onClick={handleAddAnnotation}
                disabled={!noteText.trim()}
                className="text-[9px] px-2 py-1 rounded bg-teal-mystic/10 text-teal-mystic/70 hover:bg-teal-mystic/20 disabled:opacity-30 transition-colors"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
      {visualization !== "sunburst" && hovered && (() => {
        const gap = 8;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return null;
        const sx = rect.left + hovered.x;
        const sy = rect.top + hovered.y;
        const tw = 180;
        const onRight = sx > window.innerWidth / 2;
        const left = onRight ? sx - tw - gap : sx + gap;
        const onBottom = sy > window.innerHeight / 2;
        const top = onBottom ? sy - 120 : sy + gap;
        const dotAnnotations = getAnnotations(hovered.entry.id);
        return (
          <div
            className="fixed z-50"
            style={{ left, top }}
            onMouseEnter={keepHover}
            onMouseLeave={clearHover}
          >
            <div className="bg-[rgba(6,30,40,0.92)] backdrop-blur-sm border border-teal-mystic/20 rounded-md px-2.5 py-1.5 shadow-lg max-w-[180px]">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[10px] leading-tight text-teal-mystic/90 line-clamp-2 flex-1">
                  {hovered.entry.prompt}
                </p>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(hovered.entry.id); }}
                  className="text-zinc-500 hover:text-red-400 transition-colors shrink-0 -mr-0.5 -mt-0.5"
                  title="Delete trace"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center gap-2 mt-1 text-[9px] text-zinc-400">
                <span>{new Date(hovered.entry.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                {hovered.entry.steps.length > 0 && (
                  <span>· {Math.round(hovered.entry.steps.reduce((s, st) => s + (st.duration_ms || 0), 0) / 1000)}s</span>
                )}
                {dotAnnotations.length > 0 && (
                  <span>· {dotAnnotations.length} note{dotAnnotations.length > 1 ? "s" : ""}</span>
                )}
              </div>
              {hovered.entry.ddc?.prompt && (() => {
                const e = hovered.entry.ddc!.prompt!;
                const m = e.margin ?? 0;
                const color = m > 0.05 ? "#34d399" : m > 0.02 ? "#fbbf24" : "#f87171";
                return (
                  <div className="mt-1.5 text-[8px] leading-tight flex items-center gap-1.5" title={`score: ${(e.score ?? 0).toFixed(3)} margin: ${m.toFixed(3)}`}>
                    <span className="w-1.5 h-1.5 rounded-full inline-block shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-teal-mystic/50">DDC: {e.code} {e.label}</span>
                    <span className="text-zinc-600" style={{ fontSize: "7px" }}>({(e.score ?? 0).toFixed(2)})</span>
                  </div>
                );
              })()}
              {hovered.entry.lcc?.prompt && (() => {
                const e = hovered.entry.lcc!.prompt!;
                const m = e.margin ?? 0;
                const color = m > 0.05 ? "#34d399" : m > 0.02 ? "#fbbf24" : "#f87171";
                return (
                  <div className="text-[8px] leading-tight flex items-center gap-1.5" title={`score: ${(e.score ?? 0).toFixed(3)} margin: ${m.toFixed(3)}`}>
                    <span className="w-1.5 h-1.5 rounded-full inline-block shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-purple-400/50">LCC: {e.code} {e.label}</span>
                    <span className="text-zinc-600" style={{ fontSize: "7px" }}>({(e.score ?? 0).toFixed(2)})</span>
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })()}
    </>
  );
}
