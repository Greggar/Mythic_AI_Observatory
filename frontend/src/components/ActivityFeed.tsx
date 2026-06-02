"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Zap, Cpu, Brain, Network, CheckCircle, Sparkles } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

interface ActivityEvent {
  id: string;
  kind: string;
  label: string;
  session_id: string | null;
  detail: string | null;
  timestamp: string;
}

const KIND_ICONS: Record<string, typeof Zap> = {
  session_start: Sparkles,
  session_complete: CheckCircle,
  stage_start: Activity,
  stage_complete: CheckCircle,
  inference: Brain,
};

const KIND_COLORS: Record<string, string> = {
  session_start: "text-solar-gold",
  session_complete: "text-jade-glow",
  stage_start: "text-teal-mystic",
  stage_complete: "text-zinc-500",
  inference: "text-purple-400",
};

export default function ActivityFeed() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchEvents = async () => {
    try {
      const since = events.length > 0 ? events[events.length - 1].id : undefined;
      const params = since ? `?since=${encodeURIComponent(since)}` : "";
      const res = await fetch(`${API_BASE}/api/activity${params}`);
      const data: ActivityEvent[] = await res.json();
      if (data.length > 0) {
        setEvents((prev) => [...prev, ...data].slice(-100));
      }
    } catch {
      // silently fail
    }
  };

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  return (
    <div className="glass-panel p-4 space-y-3">
      <div className="flex flex-col items-center gap-1.5 text-solar-gold">
        <Activity size={16} />
        <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
          Activity
        </span>
      </div>

      <div className="max-h-[240px] overflow-y-auto space-y-1 [&::-webkit-scrollbar]:w-[2px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[oklch(58%_0.10_75/0.35)] [&::-webkit-scrollbar-thumb]:rounded-[1px]">
        {events.length === 0 && (
          <div className="text-[10px] text-zinc-600 font-mono py-2 text-center">
            No events yet
          </div>
        )}
        <AnimatePresence initial={false}>
          {events.map((evt) => {
            const Icon = KIND_ICONS[evt.kind] || Activity;
            const color = KIND_COLORS[evt.kind] || "text-zinc-400";
            return (
              <motion.div
                key={evt.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="flex items-start gap-2 py-1.5 px-2 rounded-lg hover:bg-white/[0.02] transition-colors"
              >
                <Icon size={10} className={`${color} mt-0.5 shrink-0`} />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] text-zinc-300 font-mono leading-tight truncate">
                    {evt.label}
                  </div>
                  {evt.detail && (
                    <div className="text-[9px] text-zinc-600 font-mono truncate mt-0.5">
                      {evt.detail}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
