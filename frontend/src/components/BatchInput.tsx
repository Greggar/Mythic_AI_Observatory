"use client";

import { Upload, FileText, Play, Check, X, AlertCircle } from "lucide-react";
import { useState, useRef, useCallback, useEffect } from "react";
import type { BatchStatus } from "@/types/trace";
import { useToast } from "@/lib/ToastContext";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
const POLL_MS = 2000;

interface Props {
  onBatchComplete?: () => void;
}

export default function BatchInput({ onBatchComplete }: Props) {
  const { addToast } = useToast();
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [status, setStatus] = useState<BatchStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const parseFile = useCallback((f: File) => {
    setError(null);
    if (!f.name.endsWith(".txt")) {
      setError("Only .txt files are supported");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const allLines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      if (allLines.length === 0) {
        setError("File is empty");
        return;
      }
      if (allLines.length > 500) {
        setError("Maximum 500 prompts per batch");
        return;
      }
      setFile(f);
      setLines(allLines);
    };
    reader.readAsText(f);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) parseFile(f);
  }, [parseFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) parseFile(f);
  }, [parseFile]);

  const startBatch = useCallback(async () => {
    if (lines.length === 0) return;
    setRunning(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(`${API_BASE}/api/traces/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompts: lines }),
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const data = await res.json();
      setBatchId(data.batch_id);
      // Start polling
      const poll = async () => {
        try {
          const pr = await fetch(`${API_BASE}/api/traces/batch/${data.batch_id}`);
          if (pr.ok) {
            const ps: BatchStatus = await pr.json();
            setStatus(ps);
            if (ps.status === "done") {
              stopPolling();
              setRunning(false);
              onBatchComplete?.();
              if (ps.failed === 0) {
                addToast(`Batch complete: ${ps.completed} / ${ps.total} traces`, "success");
              } else {
                const details = ps.error_details?.length
                  ? ps.error_details.map((e) => `Line ${e.line}: ${e.error}`).join("; ")
                  : "";
                addToast(
                  `Batch complete: ${ps.completed} done, ${ps.failed} failed` +
                    (details ? ` — ${details}` : ""),
                  "error",
                  6000
                );
              }
            }
          }
        } catch {
          // keep polling
        }
      };
      poll();
      pollRef.current = setInterval(poll, POLL_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch request failed");
      setRunning(false);
    }
  }, [lines, stopPolling, onBatchComplete, addToast]);

  const pct = status ? Math.round(((status.completed + status.failed) / status.total) * 100) : 0;

  return (
    <div className="glass-panel p-4 space-y-3">
      <div className="flex flex-col items-center gap-1.5 text-teal-mystic/60">
        <FileText size={16} />
        <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
          Batch Prompts
        </span>
      </div>

      {!file && !running && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            dragOver
              ? "border-teal-mystic/50 bg-teal-mystic/5"
              : "border-white/[0.08] hover:border-white/[0.15]"
          }`}
        >
          <Upload size={20} className="mx-auto mb-2 text-zinc-500" />
          <div className="text-xs text-zinc-500 font-mono">
            Drop a .txt file here
          </div>
          <div className="text-[10px] text-zinc-600 mt-1 font-mono">
            or click to browse (one prompt per line)
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".txt"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      )}

      {file && !running && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 bg-white/[0.03] rounded-lg p-3">
            <FileText size={14} className="text-teal-mystic shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-zinc-300 truncate font-mono">{file.name}</div>
              <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                {lines.length} prompt{lines.length !== 1 ? "s" : ""}
                {" — "}~{Math.round(lines.length * 45)}s est.
              </div>
            </div>
            <button
              onClick={() => { setFile(null); setLines([]); setError(null); }}
              className="text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-1.5 text-[11px] text-[oklch(55%_0.22_30)]">
              <AlertCircle size={12} />
              {error}
            </div>
          )}

          <button
            onClick={startBatch}
            disabled={lines.length === 0 || !!error}
            className="w-full px-4 py-2 rounded-lg text-[11px] font-semibold tracking-wider uppercase
              bg-teal-mystic/10 text-teal-mystic border border-teal-mystic/20
              hover:bg-teal-mystic/20 transition-colors
              disabled:opacity-30 disabled:cursor-not-allowed
              flex items-center justify-center gap-2"
          >
            <Play size={12} />
            Run Batch ({lines.length})
          </button>
        </div>
      )}

      {running && status && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] font-mono">
            <span className="text-zinc-400">
              {status.completed + status.failed} / {status.total}
            </span>
            <span className={`${pct === 100 ? "text-jade-glow" : "text-zinc-400"}`}>
              {pct}%
            </span>
          </div>
          <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                status.failed > 0 ? "bg-[oklch(55%_0.22_30)]" : "bg-teal-mystic"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-jade-glow">
              {status.completed} completed
            </span>
            {status.failed > 0 && (
              <span className="text-[oklch(55%_0.22_30)]">
                {status.failed} failed
              </span>
            )}
          </div>
          {pct === 100 && (
            <div className="flex items-center gap-1.5 text-[11px] text-jade-glow justify-center pt-1">
              <Check size={12} />
              Batch complete
            </div>
          )}
        </div>
      )}

      {running && !status && (
        <div className="flex items-center justify-center gap-2 text-xs text-zinc-500 py-4">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-solar-gold animate-pulse" />
          Starting batch...
        </div>
      )}
    </div>
  );
}
