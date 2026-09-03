"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shared polling utilities.
 *
 * usePoll   — continuous polling hook (interval loop, optional visibility
 *             pause), for dashboard pollers like vitals / telemetry / activity.
 * pollUntil — fire-and-forget poll-until-done for job-style endpoints
 *             (orchestrate, chat exchanges, probe runs, suites, batches).
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const POLL_INTERVAL_DEFAULT = 1500;

interface UsePollOptions<T> {
  /** stop the loop while the document is hidden; resume + immediate tick on return */
  pauseOnHidden?: boolean;
  /** called with each successful result before state is committed */
  onResult?: (data: T) => void;
  /** when false, the loop does not run; flipping to true starts with an immediate tick */
  enabled?: boolean;
}

interface UsePollResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** re-run the fetcher immediately and restart the interval */
  refresh: () => void;
}

export function usePoll<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  options: UsePollOptions<T> = {},
): UsePollResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetcherRef = useRef(fetcher);
  const optionsRef = useRef(options);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const enabled = options.enabled !== false;

  const tick = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetcherRef.current();
      optionsRef.current.onResult?.(result);
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pauseOnHidden = optionsRef.current.pauseOnHidden;

    const schedule = (delay: number) => {
      if (cancelled) return;
      timer = setTimeout(async () => {
        await tick();
        if (!cancelled) schedule(intervalMs);
      }, delay);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        tick();
        if (!timer) schedule(intervalMs);
      } else if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    // First tick is flushed on the microtask queue — before the browser gets a
    // chance to idle — so the first fetch lands at t≈0 rather than after a
    // setTimeout(0) macrotask. The recurring interval only starts once that
    // first tick has completed, so a slow first fetch never overlaps itself.
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      await tick();
      if (!cancelled) schedule(intervalMs);
    });
    if (pauseOnHidden) {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      setLoading(false);
    };
  }, [intervalMs, refreshKey, tick, enabled]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return { data, loading, error, refresh };
}

export interface PollUntilOptions<T> {
  intervalMs?: number;
  timeoutMs?: number;
  /** called with every successful tick result before the done-check runs */
  onTick?: (result: T) => void;
}

export interface PollHandle<T> {
  promise: Promise<T>;
  stop: () => void;
}

/**
 * Poll a job endpoint until `done` returns true. Transient fetch failures are
 * swallowed (keep polling). The returned `stop()` aborts the loop; the promise
 * settles with the final result (or rejects with AbortError / timeout).
 */
export function pollUntil<T>(
  run: () => Promise<T>,
  done: (result: T) => boolean,
  options: PollUntilOptions<T> = {},
): PollHandle<T> {
  const { intervalMs = POLL_INTERVAL_DEFAULT, timeoutMs = 0, onTick } = options;
  let stopped = false;
  const started = Date.now();

  const promise = (async () => {
    for (;;) {
      let result: T | null = null;
      try {
        result = await run();
      } catch {
        // transient failure — keep polling
      }
      if (result !== null) {
        onTick?.(result);
        if (done(result)) return result;
      }
      if (stopped) {
        throw new DOMException("pollUntil cancelled", "AbortError");
      }
      if (timeoutMs > 0 && Date.now() - started > timeoutMs) {
        throw new Error(`pollUntil: timed out after ${timeoutMs}ms`);
      }
      await sleep(intervalMs);
    }
  })();

  return {
    promise,
    stop: () => {
      stopped = true;
    },
  };
}