"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { History, Clock, CheckCircle, XCircle, ChevronRight } from "lucide-react";

interface HistoryEntry {
  id: string;
  prompt: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  output: string | null;
  steps: { duration_ms: number | null }[];
}

interface Props {
  onSelect: (traceId: string) => void;
  refreshTrigger: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

function formatDuration(steps: { duration_ms: number | null }[]): string {
  const total = steps.reduce((acc, s) => acc + (s.duration_ms || 0), 0);
  if (total > 1000) return `${(total / 1000).toFixed(1)}s`;
  return `${total}ms`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function HistoryPanel({ onSelect, refreshTrigger }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE}/api/traces?limit=30`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshTrigger]);

  return (
    <div className="glass-panel p-5 space-y-4">
      <div className="flex flex-col items-center gap-1.5 text-teal-mystic">
        <History size={16} />
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">History</span>
          {loading && (
            <motion.span
              className="inline-block w-1.5 h-1.5 rounded-full bg-teal-mystic"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
          )}
        </div>
      </div>

      <div className="space-y-1.5 max-h-64 overflow-y-auto scrollbar-thin">
        {entries.length === 0 && !loading ? (
          <p className="text-xs text-zinc-600 text-center py-6">No traces yet</p>
        ) : entries.map((entry) => (
          <motion.button
            key={entry.id}
            onClick={() => onSelect(entry.id)}
            className="w-full flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] hover:bg-white/[0.05] transition-colors text-left"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="mt-0.5 shrink-0">
              {entry.status === "complete" ? (
                <CheckCircle size={14} className="text-jade-glow" />
              ) : (
                <XCircle size={14} className="text-red-500/60" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-xs text-zinc-300 font-mono truncate">
                {entry.prompt.slice(0, 60)}
              </div>
              <div className="flex items-center gap-3 mt-1">
                <span className="flex items-center gap-1 text-[10px] font-mono text-zinc-600">
                  <Clock size={8} />
                  {formatDuration(entry.steps)}
                </span>
                <span className="text-[10px] font-mono text-zinc-600">
                  {timeAgo(entry.created_at)}
                </span>
              </div>
            </div>

            <ChevronRight size={12} className="text-zinc-600 shrink-0 mt-1" />
          </motion.button>
        ))}
      </div>
    </div>
  );
}
