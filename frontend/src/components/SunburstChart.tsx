"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { arc } from "d3";

const W = 420;
const H = 420;
const CX = W / 2;
const CY = H / 2;
const INNER = 48;
const LEVEL1_OUTER = 110;
const LEVEL2_INNER = 116;
const OUTER = 195;
const GAP = 0.008;

const CLASS_NAMES: Record<string, string> = {
  "0": "General & CS",
  "1": "Philosophy",
  "2": "Religion",
  "3": "Social Sciences",
  "4": "Language",
  "5": "Science",
  "6": "Technology",
  "7": "Arts",
  "8": "Literature",
  "9": "History & Geo",
};

const LCC_NAMES: Record<string, string> = {
  A: "General Works",
  B: "Philosophy & Religion",
  C: "History",
  D: "World History",
  G: "Geography & Anthropology",
  H: "Social Sciences",
  J: "Political Science",
  N: "Arts",
  P: "Language & Literature",
  Q: "Sciences",
  R: "Medicine",
  T: "Technology",
};

const COLORS: Record<string, string> = {
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

const UNCLASS = "#374151";

interface ClassDisplay {
  code: string; label: string; action: string | null; domain: string | null;
}
interface HistoryEntry {
  id: string; prompt: string; status: string; created_at: string;
  output: string | null;
  steps: { duration_ms: number | null }[];
  ddc?: { prompt: ClassDisplay | null; response: ClassDisplay | null; prompt_alternatives?: ClassDisplay[]; response_alternatives?: ClassDisplay[] } | null;
  lcc?: { prompt: ClassDisplay | null; response: ClassDisplay | null; prompt_alternatives?: ClassDisplay[]; response_alternatives?: ClassDisplay[] } | null;
}

interface Wedge {
  path: string;
  name: string;
  code?: string;
  count: number;
  depth: number;
  color: string;
  startAngle: number;
  endAngle: number;
}

const arcGen = arc();

function computeWedges(entries: HistoryEntry[], system: "ddc" | "lcc"): Wedge[] {
  const codeCounts = new Map<string, number>();
  const codeLabels = new Map<string, string>();
  let unclassified = 0;

  const mainClasses = system === "ddc" ? CLASS_NAMES : LCC_NAMES;
  const colors = system === "ddc" ? COLORS : LCC_COLORS;
  const classKeys = system === "ddc" ? "0123456789" : Object.keys(mainClasses).sort();
  const getKey = system === "ddc" ? (c: string) => c[0] : (c: string) => c[0].toUpperCase();

  for (const e of entries) {
    const d = system === "ddc" ? (e.ddc?.prompt ?? null) : (e.lcc?.prompt ?? null);
    if (d?.code) {
      codeCounts.set(d.code, (codeCounts.get(d.code) || 0) + 1);
      codeLabels.set(d.code, d.label);
    } else {
      unclassified++;
    }
  }

  const total = entries.length;
  if (total === 0) return [];

  const classMap = new Map<string, Array<{ code: string; label: string; count: number }>>();
  for (const [code, count] of codeCounts) {
    const key = getKey(code);
    if (!classMap.has(key)) classMap.set(key, []);
    classMap.get(key)!.push({ code, label: codeLabels.get(code) || code, count });
  }

  const raw: Array<{ name: string; code?: string; count: number; depth: number; startAngle: number; endAngle: number; color: string }> = [];
  let cursor = 0;

  for (const key of classKeys) {
    const cats = classMap.get(key);
    if (!cats) continue;
    const classTotal = cats.reduce((s, c) => s + c.count, 0);
    const classAngle = (classTotal / total) * 2 * Math.PI;

    raw.push({
      name: mainClasses[key] || key,
      code: key,
      count: classTotal,
      depth: 0,
      startAngle: cursor,
      endAngle: cursor + classAngle,
      color: colors[key] || UNCLASS,
    });

    for (const cat of cats) {
      const ca = (cat.count / total) * 2 * Math.PI;
      raw.push({
        name: `${cat.code} ${cat.label}`,
        code: cat.code,
        count: cat.count,
        depth: 1,
        startAngle: cursor,
        endAngle: cursor + ca,
        color: colors[key] || UNCLASS,
      });
      cursor += ca;
    }
  }

  if (unclassified > 0) {
    const a = (unclassified / total) * 2 * Math.PI;
    raw.push({ name: "Unclassified", count: unclassified, depth: 0, startAngle: cursor, endAngle: cursor + a, color: UNCLASS });
  }

  return raw.map((w) => {
    const r0 = w.depth === 0 ? INNER : LEVEL2_INNER;
    const r1 = w.depth === 0 ? LEVEL1_OUTER : OUTER;
    const safe = (a: number) => isNaN(a) || !isFinite(a) ? 0 : a;
    return {
      ...w,
      path: arcGen({
        innerRadius: r0 + 1.5,
        outerRadius: r1 - 1.5,
        startAngle: safe(w.startAngle + GAP),
        endAngle: safe(w.endAngle - GAP),
      }) || "",
    };
  });
}

function computeMultilabelWedges(entries: HistoryEntry[]): Wedge[] {
  const codeCounts = new Map<string, number>();
  const codeLabels = new Map<string, string>();
  let unclassified = 0;

  for (const e of entries) {
    const d = e.ddc?.prompt ?? null;
    if (d?.code) {
      codeCounts.set(d.code, (codeCounts.get(d.code) || 0) + 1);
      codeLabels.set(d.code, d.label);
    } else {
      unclassified++;
    }
  }

  const total = entries.length;
  if (total === 0) return [];

  const classMap = new Map<string, Array<{ code: string; label: string; count: number }>>();
  for (const [code, count] of codeCounts) {
    const digit = code[0];
    if (!classMap.has(digit)) classMap.set(digit, []);
    classMap.get(digit)!.push({ code, label: codeLabels.get(code) || code, count });
  }

  const altMap = new Map<string, Map<string, number>>();
  const respAltMap = new Map<string, Map<string, number>>();
  for (const e of entries) {
    const primary = e.ddc?.prompt?.code;
    if (!primary) continue;
    const pmc = primary[0];

    const alts = e.ddc?.prompt_alternatives ?? [];
    for (const a of alts) {
      if (!a.code) continue;
      const amc = a.code[0];
      if (amc === pmc) continue;
      if (!altMap.has(pmc)) altMap.set(pmc, new Map());
      const inner = altMap.get(pmc)!;
      inner.set(amc, (inner.get(amc) || 0) + 1);
    }

    const resAlts = e.ddc?.response_alternatives ?? [];
    for (const a of resAlts) {
      if (!a.code) continue;
      const amc = a.code[0];
      if (amc === pmc) continue;
      if (!respAltMap.has(pmc)) respAltMap.set(pmc, new Map());
      const inner = respAltMap.get(pmc)!;
      inner.set(amc, (inner.get(amc) || 0) + 1);
    }
  }

  const raw: Array<{ name: string; code?: string; count: number; depth: number; startAngle: number; endAngle: number; color: string }> = [];
  let cursor = 0;

  for (const digit of "0123456789") {
    const cats = classMap.get(digit);
    if (!cats) continue;
    const classTotal = cats.reduce((s, c) => s + c.count, 0);
    const classAngle = (classTotal / total) * 2 * Math.PI;
    const wedgeStart = cursor;

    raw.push({
      name: CLASS_NAMES[digit] || digit,
      code: digit,
      count: classTotal,
      depth: 0,
      startAngle: wedgeStart,
      endAngle: wedgeStart + classAngle,
      color: COLORS[digit] || UNCLASS,
    });

    for (const cat of cats) {
      const ca = (cat.count / total) * 2 * Math.PI;
      raw.push({
        name: `${cat.code} ${cat.label}`,
        code: cat.code,
        count: cat.count,
        depth: 1,
        startAngle: cursor,
        endAngle: cursor + ca,
        color: COLORS[digit] || UNCLASS,
      });
      cursor += ca;
    }

    const addAltRing = (ringMap: Map<string, Map<string, number>>, depth: number, labelPrefix: string) => {
      const alts = ringMap.get(digit);
      if (!alts || alts.size === 0) return;
      const altTotal = [...alts.values()].reduce((s, c) => s + c, 0);
      let altCursor = wedgeStart + 0.004;
      const sortedAlts = [...alts.entries()].sort((a, b) => b[1] - a[1]);
      for (const [amc, count] of sortedAlts) {
        const fraction = count / altTotal;
        const aa = fraction * (classAngle - 0.008);
        raw.push({
          name: `${labelPrefix} ${CLASS_NAMES[amc] || amc}`,
          code: `${labelPrefix === 'Resp' ? 'resp-alt' : 'alt'}-${digit}-${amc}`,
          count,
          depth,
          startAngle: altCursor,
          endAngle: altCursor + aa,
          color: COLORS[amc] || UNCLASS,
        });
        altCursor += aa;
      }
    };

    addAltRing(altMap, 2, "Prompt Alt →");
    addAltRing(respAltMap, 3, "Resp Alt →");
  }

  if (unclassified > 0) {
    const a = (unclassified / total) * 2 * Math.PI;
    raw.push({ name: "Unclassified", count: unclassified, depth: 0, startAngle: cursor, endAngle: cursor + a, color: UNCLASS });
  }

  return raw.map((w) => {
    let r0: number, r1: number;
    if (w.depth === 0) { r0 = INNER; r1 = LEVEL1_OUTER; }
    else if (w.depth === 1) { r0 = LEVEL2_INNER; r1 = OUTER; }
    else if (w.depth === 2) { r0 = OUTER + 4; r1 = OUTER + 11; }
    else { r0 = OUTER + 12; r1 = OUTER + 19; }
    const safe = (a: number) => isNaN(a) || !isFinite(a) ? 0 : a;
    return {
      ...w,
      path: arcGen({
        innerRadius: r0 + 1.5,
        outerRadius: r1 - 1.5,
        startAngle: safe(w.startAngle + GAP),
        endAngle: safe(w.endAngle - GAP),
      }) || "",
    };
  });
}

function downloadFilteredCSV(entries: HistoryEntry[], label: string) {
  const rows = entries.map((e) => {
    const dur = e.steps.reduce((s, st) => s + (st.duration_ms || 0), 0);
    const dd = e.ddc?.prompt;
    const dr = e.ddc?.response;
    const ld = e.lcc?.prompt;
    const lr = e.lcc?.response;
    return {
      trace_id: e.id,
      prompt: e.prompt,
      status: e.status,
      output_length_chars: e.output?.length ?? 0,
      total_duration_ms: dur,
      step_count: e.steps.length,
      created_at: e.created_at,
      ddc_prompt_code: dd?.code ?? "",
      ddc_prompt_label: dd?.label ?? "",
      ddc_prompt_action: dd?.action ?? "",
      ddc_prompt_domain: dd?.domain ?? "",
      ddc_response_code: dr?.code ?? "",
      ddc_response_label: dr?.label ?? "",
      ddc_response_action: dr?.action ?? "",
      ddc_response_domain: dr?.domain ?? "",
      lcc_prompt_code: ld?.code ?? "",
      lcc_prompt_label: ld?.label ?? "",
      lcc_prompt_action: ld?.action ?? "",
      lcc_prompt_domain: ld?.domain ?? "",
      lcc_response_code: lr?.code ?? "",
      lcc_response_label: lr?.label ?? "",
      lcc_response_action: lr?.action ?? "",
      lcc_response_domain: lr?.domain ?? "",
    };
  });
  const keys = Object.keys(rows[0] ?? {});
  const csv = [keys.join(","), ...rows.map((r) => keys.map((k) => `"${String((r as Record<string, unknown>)[k]).replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `traces-${label}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function SunburstChart({ entries, grouping }: { entries: HistoryEntry[]; grouping?: string }) {
  const [hovered, setHovered] = useState<{ wedge: Wedge; x: number; y: number } | null>(null);
  const [selectedDigit, setSelectedDigit] = useState<string | null>(null);
  const [filterCode, setFilterCode] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const isMultilabel = grouping === "multilabel";
  const system: "ddc" | "lcc" = grouping === "lcc" ? "lcc" : "ddc";
  const wedges = useMemo(() => isMultilabel ? computeMultilabelWedges(entries) : computeWedges(entries, system), [entries, system, isMultilabel]);
  const total = entries.length;
  const classified = entries.filter((e) => {
    if (isMultilabel) return !!e.ddc?.prompt?.code;
    const d = system === "ddc" ? e.ddc?.prompt : e.lcc?.prompt;
    return !!d?.code;
  }).length;

  const filteredEntries = useMemo(() => {
    if (!filterCode) return entries;
    return entries.filter((e) => {
      const meta = system === "ddc" ? e.ddc : e.lcc;
      const code = meta?.prompt?.code;
      if (!code) return false;
      return filterCode.length === 1 ? code.startsWith(filterCode) : code === filterCode;
    });
  }, [entries, filterCode, system]);

  const filterLabel = useMemo(() => {
    if (!filterCode) return null;
    const w = wedges.find((w) => w.code === filterCode || (filterCode.length === 1 && w.code === filterCode && w.depth === 0));
    return w?.name ?? filterCode;
  }, [filterCode, wedges]);

  return (
    <div ref={containerRef} className="relative w-full aspect-square rounded-lg overflow-hidden"
      style={{ background: "linear-gradient(180deg, #041824 0%, #0a2d38 50%, #06303d 100%)" }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="sunburst-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(45,212,191,0.06)" />
            <stop offset="100%" stopColor="rgba(45,212,191,0)" />
          </radialGradient>
        </defs>
        <rect x={0} y={0} width={W} height={H} rx={8} fill="url(#sunburst-glow)" />

        {wedges.length === 0 && (
          <text x={CX} y={CY} textAnchor="middle" fill="rgba(82,82,91,0.6)" fontSize="10" fontFamily="monospace">
            No traces yet
          </text>
        )}

        <g transform={`translate(${CX}, ${CY})`}>
        {wedges.map((w, i) => {
          const dim = selectedDigit !== null && w.code?.[0] !== selectedDigit;
          return (
            <path
              key={`w-${i}`}
              d={w.path}
              fill={dim ? `${w.color}22` : w.color}
              opacity={dim ? 0.3 : w.depth === 0 ? 0.7 : 0.85}
              stroke="rgba(0,0,0,0.3)"
              strokeWidth={0.5}
              style={{ cursor: "pointer", transition: "opacity 0.15s" }}
              onMouseEnter={(e) => {
                const rect = containerRef.current?.getBoundingClientRect();
                if (rect) {
                  setHovered({ wedge: w, x: e.clientX - rect.left, y: e.clientY - rect.top });
                }
              }}
              onMouseMove={(e) => {
                const rect = containerRef.current?.getBoundingClientRect();
                if (rect && hovered) {
                  setHovered({ wedge: w, x: e.clientX - rect.left, y: e.clientY - rect.top });
                }
              }}
              onMouseLeave={() => setHovered(null)}
              onClick={() => {
                if (w.depth >= 2) return;
                const digit = w.code?.[0];
                setSelectedDigit(selectedDigit === digit ? null : (digit ?? null));
                const code = w.depth === 0 ? (w.code?.length === 1 ? w.code : w.code?.[0]) : w.code;
                setFilterCode(filterCode === (code ?? null) ? null : (code ?? null));
              }}
            />
          );
        })}

        </g>
        {/* Center label */}
        <circle cx={CX} cy={CY} r={INNER - 6} fill="rgba(6,30,40,0.85)" stroke="rgba(45,212,191,0.12)" strokeWidth={0.5} />
        <text x={CX} y={CY - 4} textAnchor="middle" fill="rgba(45,212,191,0.7)" fontSize="14" fontFamily="monospace" fontWeight="bold">
          {total}
        </text>
        <text x={CX} y={CY + 10} textAnchor="middle" fill="rgba(45,212,191,0.35)" fontSize="7.5" fontFamily="monospace">
          traces
        </text>
        <text x={CX} y={CY + 22} textAnchor="middle" fill="rgba(45,212,191,0.2)" fontSize="6" fontFamily="monospace">
          {classified} classified
        </text>
      </svg>

      <div className="absolute top-2 left-2">
        <span className="text-[8px] font-mono tracking-wider text-zinc-600">
          {isMultilabel
            ? "Multi-Label (DDC)"
            : system === "ddc"
              ? "Dewey Decimal"
              : "Library of Congress"}
        </span>
      </div>

      {filterCode && (
        <div className="absolute top-2 right-2 flex items-center gap-2">
          <span className="text-[9px] font-mono text-teal-mystic/60">
            {filteredEntries.length} trace{filteredEntries.length !== 1 ? "s" : ""} · {filterLabel}
          </span>
          <button
            onClick={() => downloadFilteredCSV(filteredEntries, filterLabel ?? filterCode)}
            className="text-[9px] px-2 py-1 rounded bg-teal-mystic/10 text-teal-mystic/70 hover:bg-teal-mystic/20 border border-teal-mystic/20 transition-colors"
          >
            Export CSV
          </button>
          <button
            onClick={() => { setFilterCode(null); setSelectedDigit(null); }}
            className="text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {typeof document !== "undefined" && hovered && createPortal(
        (() => {
          const gap = 8;
          const rect = containerRef.current?.getBoundingClientRect();
          if (!rect) return null;
          const sx = rect.left + hovered.x;
          const sy = rect.top + hovered.y;
          const tw = 200;
          const onRight = sx > window.innerWidth / 2;
          const left = onRight ? sx - tw - gap : sx + gap;
          const onBottom = sy > window.innerHeight / 2;
          const top = onBottom ? sy - 90 : sy + gap;
          const w = hovered.wedge;
          const pct = total > 0 ? ((w.count / total) * 100).toFixed(1) : "0";
          return (
            <div
              className="fixed z-[100] pointer-events-none"
              style={{ left, top }}
            >
              <div className="bg-[rgba(6,30,40,0.92)] backdrop-blur-sm border border-teal-mystic/20 rounded-md px-2.5 py-1.5 shadow-lg max-w-[200px]">
                <p className="text-[11px] leading-tight text-teal-mystic/90 font-medium">{w.name}</p>
                {w.code && (
                  <p className="text-[9px] text-zinc-500 mt-0.5">{w.code}</p>
                )}
                <div className="flex items-center gap-3 mt-1.5 text-[9px] text-zinc-400">
                  <span>{w.count} trace{w.count !== 1 ? "s" : ""}</span>
                  <span>({pct}%)</span>
                  <span className="capitalize">{w.depth === 0 ? "main class" : "category"}</span>
                </div>
              </div>
            </div>
          );
        })(),
        document.body
      )}
    </div>
  );
}
