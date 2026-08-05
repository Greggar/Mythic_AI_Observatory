"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import ErrorBoundary from "@/components/ErrorBoundary";
import SystemVitalsPanel from "@/components/SystemVitalsPanel";
import SettingsModal from "@/components/SettingsModal";
import SolarNexus from "@/components/SolarNexus";
import PromptInput from "@/components/PromptInput";
import BatchInput from "@/components/BatchInput";
import ObservatoryPanel from "@/components/ObservatoryPanel";
import TraceTimeline from "@/components/TraceTimeline";
import IntelligencePanel from "@/components/IntelligencePanel";
import ResourceConstellation from "@/components/ResourceConstellation";
import DiscoveryEvents from "@/components/DiscoveryEvents";
import MemoryConstellation from "@/components/MemoryConstellation";
import TraceTable from "@/components/TraceTable";
import EngineStatusPanel from "@/components/EngineStatusPanel";
import ActivityFeed from "@/components/ActivityFeed";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useOrchestrate } from "@/hooks/useOrchestrate";
import { useChat } from "@/hooks/useChat";
import { useTraceReplay } from "@/hooks/useTraceReplay";
import { emitAudioEvent } from "@/lib/audioService";
import { HoverProvider } from "@/lib/HoverContext";
import CelestialDistribution from "@/components/CelestialDistribution";
import LatencyBreakdown from "@/components/LatencyBreakdown";
import PerformanceInsights from "@/components/PerformanceInsights";
import PersonalityProfile from "@/components/PersonalityProfile";
import TraceSummaryModal from "@/components/TraceSummaryModal";
import RelationshipsPanel from "@/components/RelationshipsPanel";
import TestRunner from "@/components/TestRunner";
import TestComparison from "@/components/TestComparison";
import LogTerminal from "@/components/LogTerminal";
import ModelSwitcher from "@/components/ModelSwitcher";
import ComparativeRadarPanel from "@/components/ComparativeRadarPanel";
import SetupWizard from "@/components/SetupWizard";
import Galaxy3D from "@/components/Galaxy3D";
import ChatPanel from "@/components/ChatPanel";
import type { Probe, ModelOption, TraceSession } from "@/types/trace";
import { DEFAULT_CHART } from "@/data/chartOptions";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export default function Home() {
  const { data: telemetry, connected } = useWebSocket();
  const { trace, loading, submit } = useOrchestrate();
  const chat = useChat();
  const { activeStepIndex, phase } = useTraceReplay(trace);
  const [liveComplete, setLiveComplete] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [replayTrace, setReplayTrace] = useState<typeof trace>(null);
  const [discoveryTrigger, setDiscoveryTrigger] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [groupingMethod, setGroupingMethod] = useState<string>("ddc");
  const [visualizationType, setVisualizationType] = useState<string>("constellation");
  const [batchMode, setBatchMode] = useState(false);
  const [testProbes, setTestProbes] = useState<Probe[]>([]);
  const [testModels, setTestModels] = useState<ModelOption[]>([]);
  const [showTerminal, setShowTerminal] = useState(false);
  const [compareTraces, setCompareTraces] = useState<TraceSession[]>([]);
  const [firstRun, setFirstRun] = useState<boolean | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to timeline when a history trace is selected
  useEffect(() => {
    if (replayTrace && timelineRef.current) {
      timelineRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [replayTrace]);

  // Check first-run on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/config/first-run`)
      .then((r) => r.json())
      .then((data) => setFirstRun(data.firstRun))
      .catch(() => setFirstRun(false));
  }, []);

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

  // Refresh memory constellation when a chat exchange completes
  const chatCompleted = chat.exchanges.filter((e) => e.status === "complete").length;
  useEffect(() => {
    if (chatCompleted > 0) {
      setHistoryRefresh((n) => n + 1);
    }
  }, [chatCompleted]);

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

  // Handle compare — load full trace data for selected IDs
  const handleCompare = useCallback(async (traceIds: string[]) => {
    try {
      const results = await Promise.all(
        traceIds.map((id) =>
          fetch(`${API_BASE}/api/traces/${id}`).then((r) => r.json())
        )
      );
      setCompareTraces(results);
    } catch {
      // silently fail
    }
  }, []);

  // Chat session replay — walks each complete exchange into the shared
  // analysis surface, pacing each step by that exchange's replay duration.
  // The loop lives here (not in ChatTimeline) because selecting an exchange
  // switches to the Trace tab, which unmounts the chat components.
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replayCurrent, setReplayCurrent] = useState<number | null>(null);
  const replayStopRef = useRef(false);

  const stopChatReplay = useCallback(() => {
    replayStopRef.current = true;
    setReplayPlaying(false);
    setReplayCurrent(null);
  }, []);

  const playChatReplay = useCallback(async () => {
    const ordered = [...chat.exchanges]
      .filter((e) => e.status === "complete")
      .sort((a, b) => (a.exchange_index ?? 0) - (b.exchange_index ?? 0));
    if (ordered.length < 2) return;

    replayStopRef.current = false;
    setReplayPlaying(true);

    for (let i = 0; i < ordered.length; i++) {
      if (replayStopRef.current) break;
      const exchange = ordered[i];

      // Estimate the exchange's replay duration from its step timings,
      // matching useTraceReplay's pacing (each step >= 600ms + 400ms lead).
      const stepMs = (exchange.steps ?? []).reduce((s, st) => s + Math.max(st.duration_ms ?? 300, 600), 0);
      const paceMs = Math.max(stepMs + 400, 2500);

      setReplayCurrent(i);
      await handleHistorySelect(exchange.id);

      if (replayStopRef.current) break;
      await new Promise((resolve) => setTimeout(resolve, paceMs));
    }

    if (!replayStopRef.current) {
      setReplayPlaying(false);
      setReplayCurrent(null);
    }
  }, [chat.exchanges, handleHistorySelect]);

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
  const [activeTab, setActiveTab] = useState<"systems" | "trace" | "chat" | "history" | "analysis" | "tests">("systems");
  const [analysisType, setAnalysisType] = useState<string>("synesthesia");
  const [chartType, setChartType] = useState<string>(DEFAULT_CHART[analysisType] || "confusion");

  const handleAnalysisTypeChange = useCallback((id: string) => {
    setAnalysisType(id);
    setChartType(DEFAULT_CHART[id] || "chord");
  }, []);

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
              Single Prompt
            </button>
            <button
              onClick={() => setActiveTab("chat")}
              className={`px-3 py-1.5 text-[11px] font-mono tracking-wider rounded-md transition-all ${
                activeTab === "chat"
                  ? "bg-teal-mystic/15 text-teal-mystic shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Chat
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
            <button
              onClick={() => setActiveTab("analysis")}
              className={`px-3 py-1.5 text-[11px] font-mono tracking-wider rounded-md transition-all ${
                activeTab === "analysis"
                  ? "bg-teal-mystic/15 text-teal-mystic shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Analysis
            </button>
            <button
              onClick={() => setActiveTab("tests")}
              className={`px-3 py-1.5 text-[11px] font-mono tracking-wider rounded-md transition-all ${
                activeTab === "tests"
                  ? "bg-teal-mystic/15 text-teal-mystic shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Tests
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
          <ModelSwitcher />
          <button
            onClick={() => setSettingsOpen(true)}
            className="text-zinc-600 hover:text-teal-mystic transition-colors p-2 rounded-full hover:bg-white/[0.04]"
            title="Network settings"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowTerminal(!showTerminal)}
            className={`transition-colors p-2 rounded-full hover:bg-white/[0.04] ${
              showTerminal ? "text-teal-mystic" : "text-zinc-600 hover:text-teal-mystic"
            }`}
            title="Toggle log terminal"
          >
            <span className="text-[9px] font-mono font-bold tracking-wider">$_</span>
          </button>
        </div>
      </header>

      {/* Systems Tab */}
      {activeTab === "systems" && (
        <ErrorBoundary key="systems">
          <div className="flex flex-1 gap-6">
            <aside className="w-64 shrink-0 space-y-4">
              <ErrorBoundary><SystemVitalsPanel /></ErrorBoundary>
              <ErrorBoundary><EngineStatusPanel telemetry={telemetry} /></ErrorBoundary>
            </aside>

            <section className="flex-1 flex flex-col gap-6">
              <ErrorBoundary><ResourceConstellation active={isLiveProcessing} /></ErrorBoundary>
            </section>

            <aside className="w-64 shrink-0 space-y-4">
              <ErrorBoundary><ActivityFeed /></ErrorBoundary>
            </aside>
          </div>
        </ErrorBoundary>
      )}

      {/* Trace Tab — singular, current orchestration */}
      {activeTab === "trace" && (
        <ErrorBoundary key="trace">
          <div className="flex flex-1 gap-6">
            <aside className="w-64 shrink-0 space-y-4">
              <ErrorBoundary>
                <IntelligencePanel
                  telemetry={telemetry}
                  connected={connected}
                  trace={activeTrace}
                  traceActive={activePhase === "replaying" || activePhase === "complete"}
                  activeStepIndex={activeStep}
                  phase={activePhase}
                />
              </ErrorBoundary>
              <ErrorBoundary><LatencyBreakdown refreshTrigger={historyRefresh} traceSteps={activeTrace?.steps} /></ErrorBoundary>
            </aside>

            <section className="flex-1 flex flex-col gap-6">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setBatchMode(false)}
                    className={`text-[10px] font-mono tracking-wider px-2.5 py-1 rounded-full transition-colors ${
                      !batchMode
                        ? "bg-teal-mystic/15 text-teal-mystic border border-teal-mystic/20"
                        : "text-zinc-600 hover:text-zinc-400 border border-transparent"
                    }`}
                  >
                    Single
                  </button>
                  <button
                    onClick={() => setBatchMode(true)}
                    className={`text-[10px] font-mono tracking-wider px-2.5 py-1 rounded-full transition-colors ${
                      batchMode
                        ? "bg-teal-mystic/15 text-teal-mystic border border-teal-mystic/20"
                        : "text-zinc-600 hover:text-zinc-400 border border-transparent"
                    }`}
                  >
                    Batch
                  </button>
                </div>
                {batchMode ? (
                  <BatchInput onBatchComplete={() => setHistoryRefresh((n) => n + 1)} />
                ) : (
                  <PromptInput onSubmit={handleSubmit} loading={loading} />
                )}
              </div>

              <ErrorBoundary>
                <SolarNexus
                  telemetry={telemetry}
                  trace={activeTrace}
                  traceActive={activePhase === "replaying" || activePhase === "complete"}
                  activeTraceStep={activePhase === "replaying" ? activeStep : null}
                  phase={activePhase}
                  observatoryMode={isIdle}
                />
              </ErrorBoundary>

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
              <ErrorBoundary><PerformanceInsights trace={activeTrace} /></ErrorBoundary>
            </aside>
          </div>
        </ErrorBoundary>
      )}

      {/* Chat Tab — multi-turn chat sessions */}
      {activeTab === "chat" && (
        <ErrorBoundary key="chat">
          <ChatPanel
            chatId={chat.chatId}
            exchanges={chat.exchanges}
            sending={chat.sending}
            error={chat.error}
            onSend={chat.send}
            onSelectExchange={handleHistorySelect}
            onNewChat={chat.reset}
            replayPlaying={replayPlaying}
            replayCurrent={replayCurrent}
            onPlayReplay={playChatReplay}
            onStopReplay={stopChatReplay}
          />
        </ErrorBoundary>
      )}

      {/* History Tab — pure trace browsing */}
      {activeTab === "history" && (
        <ErrorBoundary key="history">
          <div className="flex flex-1 gap-6">
            <div className="flex-1 flex flex-col gap-4">
              <div className="flex items-center gap-4 px-1 flex-wrap">
                <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-mono tracking-wider text-zinc-600 uppercase">Group by</span>
                    <select
                      value={groupingMethod}
                      onChange={(e) => setGroupingMethod(e.target.value)}
                      className="bg-white/[0.04] border border-white/[0.08] rounded text-[10px] px-2 py-1 text-zinc-400 focus:outline-none focus:border-teal-mystic/30 cursor-pointer"
                    >
                      <option value="ddc">DDC Facets</option>
                      <option value="lcc">LCC Facets</option>
                      <option value="multilabel">Multi-Label</option>
                    </select>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-mono tracking-wider text-zinc-600 uppercase">View</span>
                  <select
                    value={visualizationType}
                    onChange={(e) => setVisualizationType(e.target.value)}
                    className="bg-white/[0.04] border border-white/[0.08] rounded text-[10px] px-2 py-1 text-zinc-400 focus:outline-none focus:border-teal-mystic/30 cursor-pointer"
                  >
                    <option value="constellation">Constellation</option>
                    <option value="sunburst">Sunburst</option>
                    <option value="galaxy">3D Galaxy</option>
                  </select>
                </div>
              </div>
              {visualizationType === "galaxy" ? (
                <ErrorBoundary>
                  <Galaxy3D
                    onSelect={handleHistorySelect}
                    refreshTrigger={historyRefresh}
                  />
                </ErrorBoundary>
              ) : (
                <HoverProvider>
                  <ErrorBoundary>
                    <MemoryConstellation
                      onSelect={handleHistorySelect}
                      onCompare={handleCompare}
                      refreshTrigger={historyRefresh}
                      grouping={groupingMethod}
                      visualization={visualizationType}
                    />
                  </ErrorBoundary>
                </HoverProvider>
              )}
              {compareTraces.length >= 2 && (
                <ComparativeRadarPanel
                  traces={compareTraces}
                  onClose={() => setCompareTraces([])}
                />
              )}
              <TraceTable refreshTrigger={historyRefresh} />
            </div>
          </div>
        </ErrorBoundary>
      )}

      {/* Tests Tab — what-if classification analysis */}
      {activeTab === "tests" && (
        <ErrorBoundary key="tests">
          <div className="flex-1 max-w-4xl mx-auto w-full space-y-4">
            <TestRunner
              onRun={(probes, models) => { setTestProbes(probes); setTestModels(models); }}
              hasResults={testProbes.length > 0}
            />
            {testProbes.length > 0 && testModels.length > 0 && (
              <TestComparison probes={testProbes} models={testModels} />
            )}
          </div>
        </ErrorBoundary>
      )}

      {/* Analysis Tab — all analysis types */}
      {activeTab === "analysis" && (
        <ErrorBoundary key="analysis">
          <div className="flex flex-1 gap-6">
            <aside className="w-56 shrink-0 space-y-2">
              <div className="text-[9px] font-mono tracking-wider text-zinc-600 uppercase mb-2 px-1">Analysis Type</div>
              {[
                ["synesthesia", "Cognitive Synesthesia"],
                ["drift", "Semantic Drift"],
                ["cross", "DDC × LCC Cross"],
                ["grammar", "Grammar Schema"],
                ["mood-intent", "Mood × Intent"],
                ["memory", "Memory Grounding"],
                ["distribution", "Runtime Distribution"],
                ["personality", "Personality Profile"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => handleAnalysisTypeChange(id)}
                  className={`w-full text-left px-3 py-2 text-[11px] font-mono rounded-lg transition-all ${
                    analysisType === id
                      ? "bg-teal-mystic/10 text-teal-mystic border border-teal-mystic/20"
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.03] border border-transparent"
                  }`}
                >
                  {label}
                </button>
              ))}
            </aside>

            <section className="flex-1 flex flex-col gap-6">
              {analysisType === "distribution" ? (
                <>
                  <div className="flex items-center justify-end gap-2">
                    <select
                      value={chartType}
                      onChange={(e) => setChartType(e.target.value)}
                      className="bg-white/[0.04] border border-white/[0.08] rounded text-[9px] px-2 py-1 text-zinc-400 focus:outline-none focus:border-teal-mystic/30 cursor-pointer"
                    >
                      <option value="celestial">Celestial Scatter</option>
                      <option value="histogram">Duration Histogram</option>
                      <option value="timeline">Timeline</option>
                    </select>
                  </div>
                  {chartType === "celestial" ? (
                    <ErrorBoundary>
                      <CelestialDistribution
                        onSelect={handleHistorySelect}
                        refreshTrigger={historyRefresh}
                      />
                    </ErrorBoundary>
                  ) : (
                    <div className="glass-panel p-6 flex items-center justify-center" style={{ minHeight: "200px" }}>
                      <span className="text-[10px] font-mono text-zinc-600">Coming soon — switch to Celestial Scatter</span>
                    </div>
                  )}
                </>
              ) : analysisType === "personality" ? (
                <>
                  <div className="flex items-center justify-end gap-2">
                    <select
                      value={chartType}
                      onChange={(e) => setChartType(e.target.value)}
                      className="bg-white/[0.04] border border-white/[0.08] rounded text-[9px] px-2 py-1 text-zinc-400 focus:outline-none focus:border-teal-mystic/30 cursor-pointer"
                    >
                      <option value="cards">Profile Cards</option>
                      <option value="radar">Radar Comparison</option>
                      <option value="bar">Model Bar Chart</option>
                    </select>
                  </div>
                  {chartType === "cards" ? (
                    <ErrorBoundary><PersonalityProfile /></ErrorBoundary>
                  ) : (
                    <div className="glass-panel p-6 flex items-center justify-center" style={{ minHeight: "200px" }}>
                      <span className="text-[10px] font-mono text-zinc-600">Coming soon — switch to Profile Cards</span>
                    </div>
                  )}
                </>
              ) : (
                <ErrorBoundary>
                  <RelationshipsPanel
                    refreshTrigger={historyRefresh}
                    initialRelType={analysisType as any}
                    chartType={chartType}
                    onChartTypeChange={setChartType}
                  />
                </ErrorBoundary>
              )}
            </section>

            <aside className="w-48 shrink-0 space-y-4">
              {analysisType !== "personality" && (
                <ErrorBoundary><PersonalityProfile /></ErrorBoundary>
              )}
            </aside>
          </div>
        </ErrorBoundary>
      )}

      {showSummary && activeTrace && (
        <TraceSummaryModal trace={activeTrace} onClose={() => setShowSummary(false)} />
      )}

      {firstRun === true && <SetupWizard onComplete={() => setFirstRun(false)} />}

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Log terminal */}
      {showTerminal && (
        <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-[#050508]/80 backdrop-blur-sm border-t border-white/[0.06]">
          <LogTerminal onClose={() => setShowTerminal(false)} />
        </div>
      )}

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
