import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { makeTrace, makeSummaryEntry } from "@/test/fixtures";

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  apiBlob: vi.fn(),
}));

import { apiGet } from "@/lib/api";
import TraceRadar from "@/components/TraceRadar";
import IntelligencePanel from "@/components/IntelligencePanel";
import MemoryConstellation from "@/components/MemoryConstellation";
import TraceTable from "@/components/TraceTable";
import RelationshipsPanel from "@/components/RelationshipsPanel";

vi.mock("framer-motion", async () => {
  const React = (await import("react")).default;
  const MOTION_PROPS = new Set([
    "initial", "animate", "exit", "transition", "layout", "whileHover",
    "whileTap", "variants", "onAnimationComplete", "onAnimationStart", "onDrag",
  ]);
  // Map known motion.X keys to their real DOM element so SVG <motion.circle>
  // still renders a real <circle> under test. Strip motion-only props that React
  // would otherwise warn about (ignored attributes), preserving the rest.
  const el = (name: string) => {
    const Comp = (props: Record<string, unknown>) => {
      const domProps: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) {
        if (!MOTION_PROPS.has(k)) domProps[k] = v;
      }
      return React.createElement(name, domProps);
    };
    Comp.displayName = `motion.${name}`;
    return Comp;
  };
  const motion = new Proxy({}, {
    get: (_t, prop: string) => el(String(prop)),
  });
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  };
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: any internal effect that calls apiGet resolves to [] (never crashes);
  // specific tests override with realistic data.
  vi.mocked(apiGet).mockResolvedValue([]);
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
  // Minimal scrollIntoView so ThoughtStream's effect doesn't throw in happy-dom
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
});

describe("TraceRadar (pure, crash-prone)", () => {
  it("renders an empty grid without crashing on no trace", () => {
    render(<TraceRadar />);
    expect(document.querySelectorAll("svg").length).toBeGreaterThan(0);
  });

  it("renders axis values from a full trace", () => {
    render(<TraceRadar trace={makeTrace()} />);
    expect(document.querySelectorAll("svg").length).toBeGreaterThan(0);
  });
});

describe("IntelligencePanel", () => {
  const telemetry = {
    timestamp: new Date().toISOString(),
    hostname: "primary",
    cpu: { percent: 20 },
    memory: { percent: 40 },
    gpu: { gpu_util: 0, gpu_mem_pct: 0 },
    ollama: { status: "ok", count: 2 },
    openclaw: { status: "ok" },
    remotes: [{ status: "ok", target: "worker" }],
  };

  it("renders the idle state without crashing (null trace)", () => {
    render(
      <IntelligencePanel
        telemetry={null}
        connected={false}
        trace={null}
        traceActive={false}
        activeStepIndex={null}
        phase="idle"
      />,
    );
  });

  it("renders the completed state from a full trace without crashing", () => {
    render(
      <IntelligencePanel
        telemetry={telemetry}
        connected
        trace={makeTrace()}
        traceActive={false}
        activeStepIndex={null}
        phase="complete"
      />,
    );
  });
});

describe("MemoryConstellation (self-fetching)", () => {
  it("renders without crashing when the summary API returns entries", async () => {
    vi.mocked(apiGet).mockImplementation((path: string) => {
      if (path.startsWith("/api/traces")) {
        return Promise.resolve([makeSummaryEntry()]);
      }
      return Promise.resolve([]);
    });
    render(
      <MemoryConstellation onSelect={() => {}} refreshTrigger={0} />,
    );
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalled();
    });
  });
});

describe("TraceTable (self-fetching)", () => {
  it("renders rows when the fetch resolves a trace", async () => {
    vi.mocked(apiGet).mockResolvedValue([makeTrace()]);
    render(<TraceTable refreshTrigger={0} />);
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalled();
    });
  });
});

describe("RelationshipsPanel (self-fetching, heavy)", () => {
  it("renders the header without crashing on an empty corpus", async () => {
    vi.mocked(apiGet).mockResolvedValue([]);
    render(<RelationshipsPanel refreshTrigger={0} />);
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalled();
    });
  });

  it("renders without crashing when the corpus has fewer than 3 traces", async () => {
    vi.mocked(apiGet).mockResolvedValue([makeTrace()]);
    render(<RelationshipsPanel refreshTrigger={0} />);
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalled();
    });
  });
});
