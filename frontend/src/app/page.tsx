"use client";

import { useCallback, useEffect, useState } from "react";
import SystemVitalsPanel from "@/components/SystemVitalsPanel";
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
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [replayTrace, setReplayTrace] = useState<typeof trace>(null);
  const [discoveryTrigger, setDiscoveryTrigger] = useState(0);

  const traceActive = phase === "replaying" || phase === "complete";

  // Emit audio events for orchestration lifecycle
  const handleSubmit = useCallback(async (prompt: string) => {
    emitAudioEvent("orchestration-start", { prompt });
    setDiscoveryTrigger(0);
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

  // Use replay trace if set, otherwise use live trace
  const activeTrace = replayTrace || trace;
  const { activeStepIndex: replayStep, phase: replayPhase } = useTraceReplay(activeTrace);
  const activePhase = replayTrace ? replayPhase : phase;
  const activeStep = replayTrace ? replayStep : activeStepIndex;

  const isIdle = activePhase === "idle";

  return (
    <div className="flex flex-col flex-1 p-6 gap-6 max-w-7xl mx-auto w-full min-h-screen">
      <header className="relative flex items-center justify-center pb-2 border-b border-white/[0.04]">
        <div className="mythic-heading">
          <span className="mythic">MYTHIC</span>
          <span className="sub">AI OBSERVATORY</span>
        </div>
        {replayTrace && (
          <button
            onClick={() => setReplayTrace(null)}
            className="absolute right-0 text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors px-2 py-1 rounded-full border border-white/[0.06]"
          >
            Clear replay
          </button>
        )}
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

          <ResourceConstellation />

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

      {/* Discovery Events overlay */}
      <DiscoveryEvents
        traceConfidence={activeTrace?.confidence ?? null}
        insightTags={activeTrace?.insight_tags ?? []}
        traceId={activeTrace?.id ?? null}
        triggerEvent={discoveryTrigger}
      />

      {/* Orchestration trace output */}
      {activeTrace && (
        <div className="max-w-3xl mx-auto w-full">
          <ObservatoryPanel active={!!activeTrace}>
            <TraceTimeline trace={activeTrace} />
          </ObservatoryPanel>
        </div>
      )}
    </div>
  );
}
