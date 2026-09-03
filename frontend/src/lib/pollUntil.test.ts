import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollUntil } from "./usePoll";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pollUntil", () => {
  it("resolves once the done-check passes", async () => {
    let calls = 0;
    const handle = pollUntil(
      async () => {
        calls += 1;
        return { status: calls >= 3 ? "complete" : "running" as string };
      },
      (r) => r.status === "complete",
      { intervalMs: 100 },
    );

    const promise = handle.promise;
    const assertion = expect(promise).resolves.toEqual({ status: "complete" });
    await vi.advanceTimersByTimeAsync(250);
    await assertion;
  });

  it("swallows transient failures and keeps polling", async () => {
    let calls = 0;
    const handle = pollUntil(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("network hiccup");
        return { ok: true };
      },
      (r) => r.ok,
      { intervalMs: 100 },
    );

    const promise = handle.promise;
    const assertion = expect(promise).resolves.toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(150);
    await assertion;
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("calls onTick on every successful tick before the done-check", async () => {
    const ticks: string[] = [];
    let calls = 0;
    pollUntil(
      async () => {
        calls += 1;
        return { status: calls < 2 ? "running" as string : "complete" };
      },
      (r) => r.status === "complete",
      { intervalMs: 100, onTick: (r) => ticks.push(r.status) },
    );

    await vi.advanceTimersByTimeAsync(250);
    expect(ticks).toEqual(["running", "complete"]);
  });

  it("rejects with AbortError after stop()", async () => {
    const handle = pollUntil(async () => ({ status: "running" as string }), () => false, {
      intervalMs: 100,
    });

    const promise = handle.promise.then(
      () => {
        throw new Error("should not resolve");
      },
      (e: unknown) => e,
    );

    handle.stop();
    const err = await promise;
    expect(err).toMatchObject({ name: "AbortError" });
  });

  it("rejects after the timeout", async () => {
    const handle = pollUntil(async () => ({ status: "running" as string }), () => false, {
      intervalMs: 50,
      timeoutMs: 300,
    });

    const promise = handle.promise.then(
      () => {
        throw new Error("should not resolve");
      },
      (e: Error) => e.message,
    );

    await vi.advanceTimersByTimeAsync(350);
    expect(await promise).toContain("timed out");
  });
});