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
import ActivityFeed from "@/components/ActivityFeed";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useOrchestrate } from "@/hooks/useOrchestrate";
import { useTraceReplay } from "@/hooks/useTraceReplay";
import { emitAudioEvent } from "@/lib/audioService";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

export default function Home() {
  const { data: telemetry, connected } = useWebSocket();
  const { trace, loading, submit } = useOrchestrate();
  const { activeStepIndex, phase } = useTraceReplay(trace);
  const [liveComplete, setLiveComplete] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [replayTrace, setReplayTrace] = useState<typeof trace>(null);
  const [discoveryTrigger, setDiscoveryTrigger] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  // Handle history replay
  const handleHistorySelect = useCallback(async (traceId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/traces/${traceId}`);
      const data = await res.json();
      setReplayTrace(data);
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

  return (
    <div className="flex flex-col flex-1 p-6 gap-6 max-w-7xl mx-auto w-full min-h-screen">
      <header className="relative flex items-center justify-center pb-2 border-b border-white/[0.04]">
        <div className="mythic-heading">
          <span className="mythic">MYTHIC</span>
          <span className="sub">AI OBSERVATORY</span>
        </div>

        {/* Session ID badge */}
        {activeTrace && (
          <div className="absolute left-0 flex items-center gap-2">
            <span className="text-[9px] font-mono tracking-wider px-2 py-1 rounded-full
              bg-teal-mystic/[0.08] text-teal-mystic border border-teal-mystic/[0.15]">
              ORCH-{activeTrace.id}
            </span>
            {isLiveProcessing && (
              <span className="text-[9px] font-mono text-solar-gold animate-pulse">● LIVE</span>
            )}
          </div>
        )}

        <div className="absolute right-0 flex items-center gap-2">
          <button
            onClick={() => setSettingsOpen(true)}
            className="text-zinc-600 hover:text-teal-mystic transition-colors p-2 rounded-full hover:bg-white/[0.04]"
            title="Network settings"
          >
            <Settings className="w-4 h-4" />
          </button>
          {replayTrace && (
            <button
              onClick={() => setReplayTrace(null)}
              className="text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors px-2 py-1 rounded-full border border-white/[0.06]"
            >
              Clear replay
            </button>
          )}
        </div>
      </header>

      {/* Main layout — 3 columns */}
      <div className="flex flex-1 gap-6">
        {/* Left — Telemetry */}
        <aside className="w-64 shrink-0 space-y-4">
          <SystemVitalsPanel />
        </aside>

        {/* Centre — Visualisation + Input */}
        <section className="flex-1 flex flex-col gap-6">
          <SolarNexus
            telemetry={telemetry}
            trace={activeTrace}
            traceActive={activePhase === "replaying" || activePhase === "complete"}
            activeTraceStep={activePhase === "replaying" ? activeStep : null}
            phase={activePhase}
            observatoryMode={isIdle}
          />

          <ResourceConstellation active={isLiveProcessing} />

          <div className="flex flex-col gap-3">
            <PromptInput onSubmit={handleSubmit} loading={loading} />
          </div>
        </section>

        {/* Right — Intelligence + History */}
        <aside className="w-64 shrink-0 space-y-4">
          <ActivityFeed />
          <MemoryConstellation
            onSelect={handleHistorySelect}
            refreshTrigger={historyRefresh}
          />
          <IntelligencePanel
            telemetry={telemetry}
            connected={connected}
            trace={activeTrace}
            traceActive={activePhase === "replaying" || activePhase === "complete"}
            activeStepIndex={activeStep}
            phase={activePhase}
          />
        </aside>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Discovery Events overlay */}
      <DiscoveryEvents
        traceConfidence={activeTrace?.confidence ?? null}
        insightTags={activeTrace?.insight_tags ?? []}
        traceId={activeTrace?.id ?? null}
        triggerEvent={discoveryTrigger}
      />

      {/* Orchestration trace output */}
      {activeTrace && (
        <div ref={timelineRef} className="max-w-3xl mx-auto w-full">
          <ObservatoryPanel active={!!activeTrace}>
            <TraceTimeline trace={activeTrace} />
          </ObservatoryPanel>
        </div>
      )}
    </div>
  );
}
