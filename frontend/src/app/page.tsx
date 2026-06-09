"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import SystemVitalsPanel from "@/components/SystemVitalsPanel";
import SettingsModal from "@/components/SettingsModal";
import SolarNexus from "@/components/SolarNexus";
import PromptInput from "@/components/PromptInput";
import ObservatoryPanel from "@/components/ObservatoryPanel";
import TraceTimeline from "@/components/TraceTimeline";
import IntelligencePanel from "@/components/IntelligencePanel";
import ResourceConstellation from "@/components/ResourceConstellation";
import DiscoveryEvents from "@/components/DiscoveryEvents";
import MemoryConstellation from "@/components/MemoryConstellation";
import EngineStatusPanel from "@/components/EngineStatusPanel";
import ActivityFeed from "@/components/ActivityFeed";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useOrchestrate } from "@/hooks/useOrchestrate";
import { useTraceReplay } from "@/hooks/useTraceReplay";
import { emitAudioEvent } from "@/lib/audioService";
import { HoverProvider } from "@/lib/HoverContext";
import CelestialDistribution from "@/components/CelestialDistribution";
import LatencyBreakdown from "@/components/LatencyBreakdown";
import PerformanceInsights from "@/components/PerformanceInsights";
import TraceSummaryModal from "@/components/TraceSummaryModal";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export default function Home() {
  const { data: telemetry, connected } = useWebSocket();
  const { trace, loading, submit } = useOrchestrate();
  const { activeStepIndex, phase } = useTraceReplay(trace);
  const [liveComplete, setLiveComplete] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [replayTrace, setReplayTrace] = useState<typeof trace>(null);
  const [discoveryTrigger, setDiscoveryTrigger] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to timeline when a history trace is selected
  useEffect(() => {
    if (replayTrace && timelineRef.current) {
      timelineRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [replayTrace]);

  // Track live polling completion
  useEffect(() => {
    if (trace && trace.status === "complete" && !loading) {
      setLiveComplete(true);
    }
  }, [trace?.status, loading]);

  // Refresh memory constellation when a new trace completes
  useEffect(() => {
    if (trace && trace.status === "complete") {
      setHistoryRefresh((n) => n + 1);
    }
  }, [trace?.status]);

  const isLiveProcessing = loading && trace !== null;
  const traceActive = phase === "replaying" || phase === "complete" || isLiveProcessing || liveComplete;

  // Derive live step index from the trace itself when polling
  const liveStepIndex = isLiveProcessing
    ? trace!.steps.findLastIndex((s) => s.status !== "pending")
    : null;

  // Emit audio events for orchestration lifecycle
  const handleSubmit = useCallback(async (prompt: string) => {
    emitAudioEvent("orchestration-start", { prompt });
    setDiscoveryTrigger(0);
    setLiveComplete(false);
    await submit(prompt);
  }, [submit]);

  // Trigger discovery events on completion
  useEffect(() => {
    if (phase === "complete" && trace?.confidence !== undefined) {
      setDiscoveryTrigger((prev) => prev + 1);
    }
  }, [phase, trace?.confidence]);

  // Handle history replay — load trace and switch to Trace tab
  const handleHistorySelect = useCallback(async (traceId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/traces/${traceId}`);
      const data = await res.json();
      setReplayTrace(data);
      setActiveTab("trace");
    } catch {
      // silently fail
    }
  }, []);

  // Determine active display state
  // During live processing: use liveStepIndex from the incremental trace
  // After live completion: trigger replay on the completed trace
  // For history replays: use the replay directly
  const triggerReplay = (replayTrace || (liveComplete && trace?.status === "complete")) ? (replayTrace || trace) : null;
  const { activeStepIndex: replayStep, phase: replayPhase } = useTraceReplay(triggerReplay);
  const activePhase = replayTrace
    ? replayPhase
    : isLiveProcessing
      ? "replaying"
      : liveComplete
        ? replayPhase
        : phase;
  const activeStep = replayTrace
    ? replayStep
    : isLiveProcessing
      ? liveStepIndex
      : (liveComplete ? replayStep : activeStepIndex);

  const activeTrace = replayTrace || trace;

  const isIdle = !activeTrace && !loading;
  const [activeTab, setActiveTab] = useState<"systems" | "trace" | "history">("systems");

  return (
    <div className="flex flex-col flex-1 p-6 gap-6 max-w-7xl mx-auto w-full min-h-screen">
      <header className="relative flex items-center pb-2 border-b border-white/[0.04]">
        {/* Tab bar — left */}
        <div className="flex items-center gap-6">
          <div className="mythic-heading shrink-0">
            <span className="mythic">MYTHIC</span>
            <span className="sub">AI OBSERVATORY</span>
          </div>
          <nav className="flex items-center gap-1 bg-white/[0.03] rounded-lg p-0.5 border border-white/[0.06]">
            <button
              onClick={() => setActiveTab("systems")}
              className={`px-3 py-1.5 text-[11px] font-mono tracking-wider rounded-md transition-all ${
                activeTab === "systems"
                  ? "bg-teal-mystic/15 text-teal-mystic shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Systems
            </button>
            <button
              onClick={() => setActiveTab("trace")}
              className={`px-3 py-1.5 text-[11px] font-mono tracking-wider rounded-md transition-all ${
                activeTab === "trace"
                  ? "bg-teal-mystic/15 text-teal-mystic shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Trace
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`px-3 py-1.5 text-[11px] font-mono tracking-wider rounded-md transition-all ${
                activeTab === "history"
                  ? "bg-teal-mystic/15 text-teal-mystic shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              History
            </button>
          </nav>
        </div>

        {/* Session ID badge */}
        {activeTrace && (
          <div className="flex items-center gap-2 ml-3">
            <span className="text-[9px] font-mono tracking-wider px-2 py-1 rounded-full
              bg-teal-mystic/[0.08] text-teal-mystic border border-teal-mystic/[0.15]">
              ORCH-{activeTrace.id}
            </span>
            {isLiveProcessing && (
              <span className="text-[9px] font-mono text-solar-gold animate-pulse">● LIVE</span>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {activeTrace && (
            <button
              onClick={() => setShowSummary(true)}
              className="text-[10px] font-mono text-zinc-600 hover:text-teal-mystic transition-colors px-2 py-1 rounded-full border border-white/[0.06]"
            >
              Print
            </button>
          )}
          {replayTrace && (
            <button
              onClick={() => setReplayTrace(null)}
              className="text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors px-2 py-1 rounded-full border border-white/[0.06]"
            >
              Clear replay
            </button>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            className="text-zinc-600 hover:text-teal-mystic transition-colors p-2 rounded-full hover:bg-white/[0.04]"
            title="Network settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Systems Tab */}
      {activeTab === "systems" && (
        <div className="flex flex-1 gap-6">
          <aside className="w-64 shrink-0 space-y-4">
            <SystemVitalsPanel />
            <EngineStatusPanel telemetry={telemetry} />
          </aside>

          <section className="flex-1 flex flex-col gap-6">
            <ResourceConstellation active={isLiveProcessing} />
          </section>

          <aside className="w-64 shrink-0 space-y-4">
            <ActivityFeed />
          </aside>
        </div>
      )}

      {/* Trace Tab — singular, current orchestration */}
      {activeTab === "trace" && (
        <div className="flex flex-1 gap-6">
          <aside className="w-64 shrink-0 space-y-4">
            <IntelligencePanel
              telemetry={telemetry}
              connected={connected}
              trace={activeTrace}
              traceActive={activePhase === "replaying" || activePhase === "complete"}
              activeStepIndex={activeStep}
              phase={activePhase}
            />
            <LatencyBreakdown refreshTrigger={historyRefresh} traceSteps={activeTrace?.steps} />
          </aside>

          <section className="flex-1 flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <PromptInput onSubmit={handleSubmit} loading={loading} />
            </div>

            <SolarNexus
              telemetry={telemetry}
              trace={activeTrace}
              traceActive={activePhase === "replaying" || activePhase === "complete"}
              activeTraceStep={activePhase === "replaying" ? activeStep : null}
              phase={activePhase}
              observatoryMode={isIdle}
            />

            {/* Trace output */}
            {activeTrace && (
              <div ref={timelineRef} className="max-w-3xl w-full">
                <ObservatoryPanel active={!!activeTrace}>
                  <TraceTimeline trace={activeTrace} />
                </ObservatoryPanel>
              </div>
            )}
          </section>

          <aside className="w-64 shrink-0 space-y-4">
            <PerformanceInsights trace={activeTrace} />
          </aside>
        </div>
      )}

      {/* History Tab — aggregate trace browsing */}
      {activeTab === "history" && (
        <div className="flex flex-1 gap-6">
          <aside className="w-64 shrink-0 space-y-4">
            <IntelligencePanel
              telemetry={telemetry}
              connected={connected}
              trace={activeTrace}
              traceActive={activePhase === "replaying" || activePhase === "complete"}
              activeStepIndex={activeStep}
              phase={activePhase}
            />
          </aside>

          <section className="flex-1 flex flex-col gap-6">
            <HoverProvider>
              <MemoryConstellation
                onSelect={handleHistorySelect}
                refreshTrigger={historyRefresh}
              />
              <CelestialDistribution
                onSelect={handleHistorySelect}
                refreshTrigger={historyRefresh}
              />
            </HoverProvider>
          </section>

          <aside className="w-64 shrink-0 space-y-4">
            {/* Future: aggregate stats, fingerprints, trace list */}
          </aside>
        </div>
      )}

      {showSummary && activeTrace && (
        <TraceSummaryModal trace={activeTrace} onClose={() => setShowSummary(false)} />
      )}

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Discovery Events overlay */}
      <DiscoveryEvents
        traceConfidence={activeTrace?.confidence ?? null}
        insightTags={activeTrace?.insight_tags ?? []}
        traceId={activeTrace?.id ?? null}
        triggerEvent={discoveryTrigger}
      />

    </div>
  );
}
