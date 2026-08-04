"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import ChatTrajectory from "@/components/ChatTrajectory";
import type { TraceSession } from "@/types/trace";

interface Props {
  chatId: string | null;
  exchanges: TraceSession[];
  sending: boolean;
  error: string | null;
  onSend: (prompt: string) => void;
  onSelectExchange: (traceId: string) => void;
  onNewChat: () => void;
}

function exchangeChips(t: TraceSession) {
  const chips: { label: string; tone: string }[] = [];
  if (t.model_used) {
    chips.push({ label: t.model_used, tone: "text-teal-mystic" });
  }
  if (t.ddc?.prompt?.code) {
    chips.push({ label: `${t.ddc.prompt.code} ${t.ddc.prompt.label}`, tone: "text-solar-gold" });
  }
  if (t.lcc?.prompt?.code) {
    chips.push({ label: t.lcc.prompt.code, tone: "text-violet-300" });
  }
  if (t.token_entropy?.mean_entropy !== undefined && t.token_entropy.mean_entropy !== null) {
    chips.push({ label: `H ${t.token_entropy.mean_entropy.toFixed(3)}`, tone: "text-zinc-400" });
  }
  return chips;
}

export default function ChatPanel({
  chatId,
  exchanges,
  sending,
  error,
  onSend,
  onSelectExchange,
  onNewChat,
}: Props) {
  const [value, setValue] = useState("");
  const spineRef = useRef<HTMLDivElement>(null);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || sending) return;
    onSend(trimmed);
    setValue("");
  };

  return (
    <div className="flex flex-1 gap-6 min-h-0">
      <div className="flex-1 flex flex-col gap-4 min-h-0">
        {/* Chat header */}
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-mono tracking-wider text-zinc-600 uppercase">
              Chat Session
            </span>
            {chatId && (
              <span className="text-[9px] font-mono tracking-wider px-2 py-0.5 rounded-full bg-teal-mystic/[0.08] text-teal-mystic border border-teal-mystic/[0.15]">
                {chatId.slice(0, 8)}
              </span>
            )}
          </div>
          <button
            onClick={onNewChat}
            className="text-[10px] font-mono text-zinc-600 hover:text-teal-mystic transition-colors px-2.5 py-1 rounded-full border border-white/[0.06]"
          >
            + New chat
          </button>
        </div>

        {/* Conversation spine */}
        <div ref={spineRef} className="flex-1 overflow-y-auto space-y-4 min-h-0 pr-1">
          {exchanges.length > 0 && (
            <ChatTrajectory exchanges={exchanges} onSelectExchange={onSelectExchange} />
          )}
          {exchanges.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 h-full text-center">
              <Sparkles className="w-6 h-6 text-teal-mystic/50" />
              <div className="text-[13px] font-mono text-zinc-400">
                Start a conversation
              </div>
              <div className="text-[10px] font-mono text-zinc-600 max-w-xs">
                Each exchange runs the full orchestration pipeline — intent,
                retrieval, classification, entropy — and appears as a linked
                trace you can open in the shared analysis surface.
              </div>
            </div>
          ) : (
            exchanges.map((t) => {
              const chips = exchangeChips(t);
              const clickable = t.status === "complete";
              return (
                <div
                  key={t.id}
                  onClick={() => clickable && onSelectExchange(t.id)}
                  className={`glass-panel p-4 space-y-2 ${
                    clickable
                      ? "cursor-pointer hover:border-teal-mystic/30 transition-colors"
                      : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono tracking-wider px-1.5 py-0.5 rounded bg-white/[0.04] text-zinc-500 border border-white/[0.06]">
                      EX-{t.exchange_index ?? exchanges.indexOf(t)}
                    </span>
                    {t.status === "processing" && (
                      <span className="flex items-center gap-1.5 text-[9px] font-mono text-solar-gold animate-pulse">
                        <span className="inline-block w-1 h-1 rounded-full bg-solar-gold" />
                        PROCESSING
                      </span>
                    )}
                    {t.status === "error" && (
                      <span className="text-[9px] font-mono text-red-400">ERROR</span>
                    )}
                    <span className="ml-auto text-[9px] font-mono text-zinc-600">
                      {t.created_at.slice(11, 19)}
                    </span>
                  </div>

                  <div className="text-sm text-zinc-200 font-mono leading-relaxed whitespace-pre-wrap">
                    {t.prompt}
                  </div>

                  <div className="pl-3 border-l border-white/[0.06]">
                    {t.status === "processing" ? (
                      <span className="text-[11px] font-mono text-zinc-500 italic">
                        Awaiting response…
                      </span>
                    ) : (
                      <div className="text-[13px] text-zinc-300 font-mono leading-relaxed whitespace-pre-wrap line-clamp-4">
                        {t.output || t.trace_explanation || "—"}
                      </div>
                    )}
                  </div>

                  {chips.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap pt-1">
                      {chips.map((c, i) => (
                        <span
                          key={`${t.id}-chip-${i}`}
                          className={`text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/[0.03] border border-white/[0.05] ${c.tone}`}
                        >
                          {c.label}
                        </span>
                      ))}
                      {clickable && (
                        <span className="ml-auto text-[9px] font-mono text-zinc-600">
                          click to analyse →
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {error && (
          <div className="text-[11px] font-mono text-red-400 px-1">{error}</div>
        )}

        {/* Message input */}
        <div className="glass-panel p-3">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend();
            }}
            placeholder="Message the observatory… (⌘+Enter to send)"
            rows={2}
            className="w-full bg-transparent text-sm text-zinc-200 placeholder-zinc-600 resize-none outline-none font-mono leading-relaxed"
            disabled={sending}
          />
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-zinc-600 font-mono">
              {sending ? "exchange in flight…" : `${exchanges.length} exchange${exchanges.length === 1 ? "" : "s"}`}
            </span>
            <motion.button
              onClick={handleSend}
              disabled={!value.trim() || sending}
              className="px-4 py-1.5 rounded-full text-[11px] font-semibold tracking-wider uppercase bg-teal-mystic/10 text-teal-mystic border border-teal-mystic/20 disabled:opacity-30 disabled:cursor-not-allowed"
              whileHover={!sending && value.trim() ? { scale: 1.02 } : {}}
              whileTap={!sending && value.trim() ? { scale: 0.98 } : {}}
            >
              {sending ? (
                <span className="flex items-center gap-2">
                  <motion.span
                    className="inline-block w-1.5 h-1.5 rounded-full bg-solar-gold"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.2, repeat: Infinity }}
                  />
                  Awakening
                </span>
              ) : (
                "Send"
              )}
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}
