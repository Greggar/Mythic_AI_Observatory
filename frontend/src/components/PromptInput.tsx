"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useState } from "react";

interface Props {
  onSubmit: (prompt: string) => void;
  loading: boolean;
}

export default function PromptInput({ onSubmit, loading }: Props) {
  const [value, setValue] = useState("");

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    onSubmit(trimmed);
  };

  return (
    <div className="glass-panel p-4 space-y-3">
      <div className="flex flex-col items-center gap-1.5 text-teal-mystic/60">
        <Sparkles size={16} />
        <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
          Orchestration Prompt
        </span>
      </div>

      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit(); }}
        placeholder="e.g. Summarize current orchestration status"
        rows={2}
        className="w-full bg-transparent text-sm text-zinc-200 placeholder-zinc-600 resize-none outline-none font-mono leading-relaxed"
        disabled={loading}
      />

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-600 font-mono">
          {loading ? "orchestrating…" : "⌘+Enter to submit"}
        </span>

        <motion.button
          onClick={handleSubmit}
          disabled={!value.trim() || loading}
          className="relative px-4 py-1.5 rounded-full text-[11px] font-semibold tracking-wider uppercase bg-teal-mystic/10 text-teal-mystic border border-teal-mystic/20 disabled:opacity-30 disabled:cursor-not-allowed"
          whileHover={!loading && value.trim() ? { scale: 1.02 } : {}}
          whileTap={!loading && value.trim() ? { scale: 0.98 } : {}}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <motion.span
                className="inline-block w-1.5 h-1.5 rounded-full bg-solar-gold"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.2, repeat: Infinity }}
              />
              Awakening
            </span>
          ) : (
            "Submit"
          )}
        </motion.button>
      </div>
    </div>
  );
}
