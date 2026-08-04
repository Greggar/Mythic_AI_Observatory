"use client";

import { useCallback, useRef, useState } from "react";
import type { TraceSession } from "@/types/trace";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
const POLL_INTERVAL = 1500;

function generateId(): string {
  // crypto.randomUUID only exists in secure contexts (HTTPS/localhost) —
  // the dashboard is served over plain HTTP on a LAN IP, so fall back.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function useChat() {
  const [chatId, setChatId] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<TraceSession[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const send = useCallback(async (prompt: string) => {
    const cid = chatId ?? generateId();
    if (cid !== chatId) setChatId(cid);
    setSending(true);
    setError(null);
    stopPolling();

    try {
      const res = await fetch(`${API_BASE}/api/orchestrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, chat_id: cid }),
      });

      if (!res.ok) {
        throw new Error(`Server responded ${res.status}`);
      }

      const { trace_id } = await res.json();

      // Optimistic placeholder so the exchange appears immediately
      setExchanges((prev) => [
        ...prev,
        {
          id: trace_id,
          prompt,
          chat_id: cid,
          status: "processing",
          steps: [],
          output: null,
          confidence: null,
          insight_tags: [],
          created_at: new Date().toISOString(),
          completed_at: null,
          model_used: null,
          agent_used: null,
          telemetry_impact: null,
        },
      ]);

      // Poll for the exchange until it completes
      const poll = async () => {
        try {
          const pollRes = await fetch(`${API_BASE}/api/traces/${trace_id}`);
          if (pollRes.ok) {
            const data: TraceSession = await pollRes.json();
            setExchanges((prev) => prev.map((e) => (e.id === trace_id ? data : e)));
            if (data.status === "complete" || data.status === "error") {
              setSending(false);
              return; // stop polling
            }
          }
        } catch {
          // keep polling
        }
        pollTimer.current = setTimeout(poll, POLL_INTERVAL);
      };

      poll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setSending(false);
    }
  }, [chatId, stopPolling]);

  const loadChat = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/chats/${id}`);
      if (res.ok) {
        const data: TraceSession[] = await res.json();
        setChatId(id);
        setExchanges(data);
        setError(null);
      }
    } catch {
      // ignore
    }
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    setChatId(null);
    setExchanges([]);
    setError(null);
    setSending(false);
  }, [stopPolling]);

  return { chatId, exchanges, sending, error, send, loadChat, reset };
}
