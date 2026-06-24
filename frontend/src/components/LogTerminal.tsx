"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { X, Terminal, Pause, Play, Trash2, Search } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface LogEntry {
  ts: string;
  level: string;
  name: string;
  msg: string;
}

const LEVEL_ORDER: Record<string, number> = {
  DEBUG: 0, INFO: 1, WARNING: 2, ERROR: 3, CRITICAL: 4,
};

const LEVEL_COLORS: Record<string, string> = {
  DEBUG: "text-zinc-600",
  INFO: "text-teal-mystic",
  WARNING: "text-solar-gold",
  ERROR: "text-red/80",
  CRITICAL: "text-red font-bold",
};

interface Props {
  onClose?: () => void;
}

export default function LogTerminal({ onClose }: Props) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [minLevel, setMinLevel] = useState<number>(LEVEL_ORDER.INFO);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Connect to SSE
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/logs/stream`);
    es.onmessage = (e) => {
      try {
        const entry: LogEntry = JSON.parse(e.data);
        setEntries((prev) => [...prev.slice(-999), entry]);
      } catch { /* ignore parse errors */ }
    };
    es.onerror = () => {
      // Reconnect is automatic with EventSource
    };
    return () => es.close();
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (!autoScrollRef.current || paused || !containerRef.current) return;
    const el = containerRef.current;
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [entries, paused]);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    autoScrollRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
  }, []);

  const filtered = entries.filter((e) => {
    if (LEVEL_ORDER[e.level] == null) return false;
    if (LEVEL_ORDER[e.level] < minLevel) return false;
    if (search && !e.msg.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const levelButtons: { label: string; level: number }[] = [
    { label: "ALL", level: 0 },
    { label: "INFO", level: 1 },
    { label: "WARN", level: 2 },
    { label: "ERR", level: 3 },
  ];

  return (
    <div className="glass-panel p-3 space-y-2 font-mono">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] text-teal-mystic/60 font-semibold tracking-wider uppercase">
          <Terminal size={12} />
          Log Tail
          <span className="text-zinc-600 normal-case font-normal">{filtered.length} entries</span>
        </div>
        <div className="flex items-center gap-1">
          {levelButtons.map((b) => (
            <button
              key={b.label}
              onClick={() => setMinLevel(b.level)}
              className={`text-[9px] px-1.5 py-0.5 rounded ${
                minLevel === b.level
                  ? "bg-teal-mystic/20 text-teal-mystic"
                  : "text-zinc-600 hover:text-zinc-400"
              }`}
            >
              {b.label}
            </button>
          ))}
          <div className="w-px h-3 bg-white/[0.06] mx-1" />
          <button
            onClick={() => setPaused(!paused)}
            className="text-zinc-600 hover:text-zinc-400 transition-colors"
            title={paused ? "Resume" : "Pause"}
          >
            {paused ? <Play size={10} /> : <Pause size={10} />}
          </button>
          <button
            onClick={() => setEntries([])}
            className="text-zinc-600 hover:text-zinc-400 transition-colors"
            title="Clear"
          >
            <Trash2 size={10} />
          </button>
          {onClose && (
            <button onClick={onClose} className="text-zinc-600 hover:text-red/70 transition-colors ml-1">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-1.5 bg-white/[0.03] rounded px-2 py-1">
        <Search size={10} className="text-zinc-600 shrink-0" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter…"
          className="bg-transparent text-[10px] text-zinc-300 w-full outline-none placeholder:text-zinc-700"
        />
      </div>

      {/* Terminal window */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-48 overflow-y-auto bg-[#0a0a0f] rounded border border-white/[0.04] p-2 space-y-0.5 text-[10px] leading-[1.4]"
      >
        {filtered.length === 0 && (
          <div className="text-zinc-700 text-center py-8">Waiting for logs…</div>
        )}
        {filtered.map((e, i) => {
          const time = e.ts.slice(11, 19);
          return (
            <div key={i} className="flex gap-2">
              <span className="text-zinc-700 shrink-0 w-14">{time}</span>
              <span className={`shrink-0 w-10 ${LEVEL_COLORS[e.level] || "text-zinc-500"}`}>
                {e.level.padEnd(5)}
              </span>
              <span className="text-zinc-400 break-all min-w-0">
                {e.msg}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
