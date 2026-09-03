import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePoll } from "./usePoll";

afterEach(() => {
  vi.useRealTimers();
});

describe("usePoll", () => {
  it("fires its first fetch before the first interval elapsed", async () => {
    vi.useFakeTimers();
    let calls = 0;
    renderHook(() =>
      usePoll(async () => {
        calls += 1;
        return { n: calls };
      }, 1000),
    );

    expect(calls).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(calls).toBe(2);
  });

  it("commits the fetched data and clears error", async () => {
    vi.useFakeTimers();
    let fail = false;
    const { result } = renderHook(() =>
      usePoll(async () => {
        if (fail) throw new Error("boom");
        return { ok: true, seed: "s" };
      }, 500),
    );

    expect(result.current.data).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data).toEqual({ ok: true, seed: "s" });
    expect(result.current.error).toBeNull();

    fail = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(result.current.error).toContain("boom");
  });

  it("calls onResult with every successful result", async () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    renderHook(() =>
      usePoll(async () => ({ n: 1 }), 200, {
        onResult: (d) => seen.push(d.n),
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(seen).toEqual([1, 1]);
  });

  it("does not poll while hidden with pauseOnHidden, resumes on visible", async () => {
    vi.useFakeTimers();
    let calls = 0;
    renderHook(() =>
      usePoll(
        async () => {
          calls += 1;
          return { n: calls };
        },
        200,
        { pauseOnHidden: true },
      ),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const firstTick = calls;

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(calls).toBe(firstTick);

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(calls).toBe(firstTick + 1);
  });

  it("respects the enabled gate and starts on flip", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        usePoll(
          async () => {
            calls += 1;
            return { n: calls };
          },
          200,
          { enabled },
        ),
      { initialProps: { enabled: false } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(calls).toBe(0);

    rerender({ enabled: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls).toBe(1);
  });

  it("refresh() triggers an immediate re-fetch", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const { result } = renderHook(() =>
      usePoll(async () => {
        calls += 1;
        return { n: calls };
      }, 1000),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls).toBe(1);

    await act(async () => {
      result.current.refresh();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls).toBe(2);
  });
});

describe("usePoll error state", () => {
  it("surfaces a fetcher rejection as error and recovers on the next tick", async () => {
    vi.useFakeTimers();
    let fail = true;
    const { result } = renderHook(() =>
      usePoll(async () => {
        if (fail) throw new Error("down");
        return { up: true };
      }, 200),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data).toBeNull();
    expect(result.current.error).toContain("down");

    fail = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current.data).toEqual({ up: true });
    expect(result.current.error).toBeNull();
  });
});