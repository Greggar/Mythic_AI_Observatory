"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TraceSession } from "@/types/trace";
import { apiGet, apiPost } from "@/lib/api";
import { pollUntil, type PollHandle } from "@/lib/usePoll";

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
  const pollRef = useRef<PollHandle<TraceSession> | null>(null);

  const stopPolling = useCallback(() => {
    pollRef.current?.stop();
    pollRef.current = null;
  }, []);

  // Abort any in-flight poll when the hook unmounts.
  useEffect(() => stopPolling, [stopPolling]);

  const send = useCallback(
    async (prompt: string) => {
      const cid = chatId ?? generateId();
      if (cid !== chatId) setChatId(cid);
      setSending(true);
      setError(null);
      stopPolling();

      try {
        const { trace_id } = await apiPost<{ trace_id: string }>("/api/orchestrate", {
          prompt,
          chat_id: cid,
        });

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

        const handle = pollUntil<TraceSession>(
          () => apiGet<TraceSession>(`/api/traces/${trace_id}`),
          (d) => d.status === "complete" || d.status === "error",
          {
            onTick: (d) =>
              setExchanges((prev) => prev.map((e) => (e.id === trace_id ? d : e))),
          },
        );
        pollRef.current = handle;
        handle.promise
          .then(() => setSending(false))
          .catch((err: unknown) => {
            if (err instanceof DOMException && err.name === "AbortError") {
              // stopped by reset/unmount — not an error
            } else {
              setError(err instanceof Error ? err.message : "Unknown error");
            }
            setSending(false);
          });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setSending(false);
      }
    },
    [chatId, stopPolling],
  );

  const loadChat = useCallback(async (id: string) => {
    try {
      const data = await apiGet<TraceSession[]>(`/api/chats/${id}`);
      setChatId(id);
      setExchanges(data);
      setError(null);
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