"use client";

import { useEffect, useState, useCallback, useMemo } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface ClassDisplay {
  code: string;
  label: string;
  score?: number;
  margin?: number;
}

interface TraceRow {
  id: string;
  prompt: string;
  output: string | null;
  ddcLabel: string;
  ddcScore: number | null;
  ddcMargin: number | null;
  lccLabel: string;
  lccScore: number | null;
  lccMargin: number | null;
}

function stripStagePrefix(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/^\[(Response Generation|Intent Classification|Context Synthesis)\]:\s*/, "");
}

function trunc(s: string | null | undefined, n: number): string {
  if (!s) return "";
  const cleaned = stripStagePrefix(s);
  return cleaned.length > n ? cleaned.slice(0, n) + "…" : cleaned;
}

function confDot(margin: number | null): string {
  if (margin === null) return "bg-zinc-700";
  if (margin > 0.05) return "bg-emerald-500";
  if (margin > 0.02) return "bg-amber-500";
  return "bg-red-500";
}

async function generateDoc(id: string): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/traces/${id}`);
    const trace = await res.json();
    const lines: string[] = [];
    lines.push("=".repeat(60));
    lines.push(`TRACE DOCUMENT — ${id}`);
    lines.push("=".repeat(60));
    lines.push("");
    lines.push(`ID:       ${trace.id}`);
    lines.push(`Status:   ${trace.status}`);
    lines.push(`Created:  ${trace.created_at || "—"}`);
    lines.push(`Complete: ${trace.completed_at || "—"}`);
    lines.push(`Model:    ${trace.model_used || "—"}`);
    lines.push(`Agent:    ${trace.agent_used || "—"}`);
    if (trace.batch_id) lines.push(`Batch:    ${trace.batch_id}`);
    lines.push("");
    lines.push("─".repeat(40));
    lines.push("PROMPT");
    lines.push("─".repeat(40));
    lines.push(trace.prompt || "—");
    lines.push("");
    lines.push("─".repeat(40));
    lines.push("RESPONSE");
    lines.push("─".repeat(40));
    lines.push(trace.output || "(empty)");
    if (trace.response_rationale) {
      lines.push("");
      lines.push("Rationale:");
      lines.push(trace.response_rationale);
    }
    lines.push("");

    if (trace.ddc?.prompt) {
      lines.push("─".repeat(40));
      lines.push("DDC CLASSIFICATION");
      lines.push("─".repeat(40));
      const p = trace.ddc.prompt;
      lines.push(`  Code:   ${p.code}`);
      lines.push(`  Label:  ${p.label}`);
      lines.push(`  Score:  ${p.score?.toFixed(4) ?? "—"}`);
      lines.push(`  Margin: ${p.margin?.toFixed(4) ?? "—"}`);
      if (p.top_scores?.length) {
        lines.push("  Top scores:");
        for (const ts of p.top_scores) {
          lines.push(`    ${ts.code} ${ts.label}: ${ts.score.toFixed(4)}`);
        }
      }
      if (trace.ddc.response) {
        const r = trace.ddc.response;
        lines.push(`  Response: ${r.code} ${r.label} (${r.score?.toFixed(4) ?? "—"})`);
      }
    }

    if (trace.lcc?.prompt) {
      lines.push("");
      lines.push("─".repeat(40));
      lines.push("LCC CLASSIFICATION");
      lines.push("─".repeat(40));
      const p = trace.lcc.prompt;
      lines.push(`  Code:   ${p.code}`);
      lines.push(`  Label:  ${p.label}`);
      lines.push(`  Score:  ${p.score?.toFixed(4) ?? "—"}`);
      lines.push(`  Margin: ${p.margin?.toFixed(4) ?? "—"}`);
      if (p.top_scores?.length) {
        lines.push("  Top scores:");
        for (const ts of p.top_scores) {
          lines.push(`    ${ts.code} ${ts.label}: ${ts.score.toFixed(4)}`);
        }
      }
    }

    if (trace.steps?.length) {
      lines.push("");
      lines.push("─".repeat(40));
      lines.push("STEPS");
      lines.push("─".repeat(40));
      for (const s of trace.steps) {
        const d = s.duration_ms != null ? `${(s.duration_ms / 1000).toFixed(1)}s` : "—";
        const tok = s.eval_count != null ? `tok:${s.eval_count}` : "";
        const model = s.model_used ? `model:${s.model_used}` : "";
        lines.push(`  ${s.status === "complete" ? "✓" : s.status === "error" ? "✗" : "○"} ${s.label} (${d}) ${tok} ${model}`.trim());
      }
    }

    if (trace.synesth) {
      lines.push("");
      lines.push("─".repeat(40));
      lines.push("SYNESTHESIA");
      lines.push("─".repeat(40));
      lines.push(`  Input:  [${trace.synesth.input_probs.map((v: number) => v.toFixed(2)).join(", ")}]`);
      lines.push(`  Output: [${trace.synesth.output_probs.map((v: number) => v.toFixed(2)).join(", ")}]`);
    }

    if (trace.trace_explanation) {
      lines.push("");
      lines.push("─".repeat(40));
      lines.push("TRACE EXPLANATION");
      lines.push("─".repeat(40));
      lines.push(trace.trace_explanation);
    }

    lines.push("");
    lines.push("=".repeat(60));
    lines.push("END OF TRACE DOCUMENT");

    const text = lines.join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trace-${id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Failed to generate trace document:", err);
  }
}

interface Props {
  refreshTrigger: number;
}

type SortKey = "id" | "prompt" | "output" | "ddcLabel" | "ddcScore" | "lccLabel" | "lccScore";

export default function TraceTable({ refreshTrigger }: Props) {
  const [rows, setRows] = useState<TraceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filterText, setFilterText] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE}/api/traces?limit=40`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const mapped: TraceRow[] = (data as any[])
          .map((t) => ({
            id: t.id,
            prompt: t.prompt || "",
            output: t.output || null,
            ddcLabel: t.ddc?.prompt ? `${t.ddc.prompt.code} ${t.ddc.prompt.label}` : "—",
            ddcScore: t.ddc?.prompt?.score ?? null,
            ddcMargin: t.ddc?.prompt?.margin ?? null,
            lccLabel: t.lcc?.prompt ? `${t.lcc.prompt.code} ${t.lcc.prompt.label}` : "—",
            lccScore: t.lcc?.prompt?.score ?? null,
            lccMargin: t.lcc?.prompt?.margin ?? null,
          }));
        setRows(mapped);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshTrigger]);

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("asc");
      return key;
    });
  }, []);

  const filtered = useMemo(() => {
    let f = rows;
    if (filterText.trim()) {
      const q = filterText.toLowerCase();
      f = rows.filter((r) =>
        r.id.toLowerCase().includes(q) ||
        r.prompt.toLowerCase().includes(q) ||
        (r.output || "").toLowerCase().includes(q) ||
        r.ddcLabel.toLowerCase().includes(q) ||
        r.lccLabel.toLowerCase().includes(q)
      );
    }
    return [...f].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "id") cmp = a.id.localeCompare(b.id);
      else if (sortKey === "prompt") cmp = a.prompt.localeCompare(b.prompt);
      else if (sortKey === "output") cmp = (a.output || "").localeCompare(b.output || "");
      else if (sortKey === "ddcLabel") cmp = a.ddcLabel.localeCompare(b.ddcLabel);
      else if (sortKey === "ddcScore") cmp = (a.ddcScore ?? -1) - (b.ddcScore ?? -1);
      else if (sortKey === "lccLabel") cmp = a.lccLabel.localeCompare(b.lccLabel);
      else if (sortKey === "lccScore") cmp = (a.lccScore ?? -1) - (b.lccScore ?? -1);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, filterText, sortKey, sortDir]);

  const handleGenerate = useCallback(async (id: string) => {
    setGenerating(id);
    await generateDoc(id);
    setGenerating(null);
  }, []);

  const sortArrow = (key: SortKey) => {
    if (sortKey !== key) return null;
    return <span className="ml-0.5 text-[8px]">{sortDir === "asc" ? "▲" : "▼"}</span>;
  };

  return (
    <div className="rounded-lg border border-white/[0.06] overflow-hidden">
      <div className="px-3 py-2 bg-white/[0.02] border-b border-white/[0.06] flex items-center gap-3 flex-wrap">
        <span className="text-[10px] font-mono text-zinc-500 shrink-0">
          Trace Log
          {loading && <span className="ml-2 text-zinc-600">loading…</span>}
          <span className="ml-2 text-zinc-600">{filtered.length}/{rows.length}</span>
        </span>
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Filter by ID, prompt, response, or classification…"
          className="flex-1 min-w-[180px] bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1 text-[10px] text-zinc-400 placeholder:text-zinc-700 focus:outline-none focus:border-teal-mystic/30"
        />
        {filterText && (
          <button onClick={() => setFilterText("")} className="text-zinc-600 hover:text-zinc-400 text-[10px]">
            clear
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] font-mono">
          <thead>
            <tr className="text-zinc-600 border-b border-white/[0.04]">
              <th className="text-left px-2 py-1.5 font-medium cursor-pointer hover:text-zinc-400 select-none" onClick={() => toggleSort("id")}>
                Trace ID{sortArrow("id")}
              </th>
              <th className="text-left px-2 py-1.5 font-medium cursor-pointer hover:text-zinc-400 select-none" onClick={() => toggleSort("prompt")}>
                Prompt{sortArrow("prompt")}
              </th>
              <th className="text-left px-2 py-1.5 font-medium cursor-pointer hover:text-zinc-400 select-none" onClick={() => toggleSort("output")}>
                Response{sortArrow("output")}
              </th>
              <th className="text-left px-2 py-1.5 font-medium cursor-pointer hover:text-zinc-400 select-none" onClick={() => toggleSort("ddcLabel")}>
                DDC{sortArrow("ddcLabel")}
              </th>
              <th className="text-left px-2 py-1.5 font-medium cursor-pointer hover:text-zinc-400 select-none" onClick={() => toggleSort("ddcScore")}>
                Conf{sortArrow("ddcScore")}
              </th>
              <th className="text-left px-2 py-1.5 font-medium cursor-pointer hover:text-zinc-400 select-none" onClick={() => toggleSort("lccLabel")}>
                LCC{sortArrow("lccLabel")}
              </th>
              <th className="text-left px-2 py-1.5 font-medium cursor-pointer hover:text-zinc-400 select-none" onClick={() => toggleSort("lccScore")}>
                Conf{sortArrow("lccScore")}
              </th>
              <th className="text-left px-2 py-1.5 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="text-center py-6 text-zinc-600">{filterText ? "No matching traces" : "No traces yet"}</td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors">
                <td className="px-2 py-1.5 text-teal-mystic/60" title={r.id}>
                  {r.id.slice(0, 8)}…
                </td>
                <td className="px-2 py-1.5 text-zinc-400 max-w-[160px] truncate" title={r.prompt}>
                  {trunc(r.prompt, 50)}
                </td>
                <td className="px-2 py-1.5 text-zinc-500 max-w-[160px] truncate" title={stripStagePrefix(r.output) || undefined}>
                  {trunc(r.output, 50) || "—"}
                </td>
                <td className="px-2 py-1.5 text-teal-mystic/50 max-w-[120px] truncate" title={r.ddcLabel}>
                  {r.ddcLabel}
                </td>
                <td className="px-2 py-1.5">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${confDot(r.ddcMargin)}`}
                    title={r.ddcScore !== null ? `score: ${r.ddcScore.toFixed(3)} margin: ${(r.ddcMargin ?? 0).toFixed(3)}` : "—"} />
                </td>
                <td className="px-2 py-1.5 text-purple-400/50 max-w-[120px] truncate" title={r.lccLabel}>
                  {r.lccLabel}
                </td>
                <td className="px-2 py-1.5">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${confDot(r.lccMargin)}`}
                    title={r.lccScore !== null ? `score: ${r.lccScore.toFixed(3)} margin: ${(r.lccMargin ?? 0).toFixed(3)}` : "—"} />
                </td>
                <td className="px-2 py-1.5">
                  <button
                    onClick={() => handleGenerate(r.id)}
                    disabled={generating === r.id}
                    className="text-zinc-500 hover:text-teal-mystic/70 disabled:text-zinc-700 transition-colors"
                    title="Generate trace document"
                  >
                    {generating === r.id ? (
                      <span className="text-zinc-600">…</span>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="12" y1="18" x2="12" y2="12" />
                        <line x1="9" y1="15" x2="15" y2="15" />
                      </svg>
                    )}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
