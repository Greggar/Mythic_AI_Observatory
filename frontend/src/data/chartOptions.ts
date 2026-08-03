export interface ChartOption {
  id: string;
  label: string;
  description: string;
}

export const CHART_OPTIONS: Record<string, ChartOption[]> = {
  synesthesia: [
    { id: "confusion", label: "Confusion Matrix", description: "Heatmap of input→output mappings" },
    { id: "heatmap", label: "Temporal Heatmap", description: "Category density over time" },
    { id: "sunburst", label: "Sunburst Hierarchy", description: "Hierarchical view of input→output paths" },
    { id: "correlation", label: "Ring Correlation", description: "Cross-ring Pearson correlation heatmap" },
  ],
  drift: [
    { id: "chord", label: "Chord Diagram", description: "DDC category shifts from prompt to response" },
    { id: "confusion", label: "Confusion Matrix", description: "Prompt DDC × Response DDC transition counts" },
    { id: "heatmap", label: "Temporal Heatmap", description: "DDC digit density over time" },
  ],
  cross: [
    { id: "chord", label: "Chord Diagram", description: "DDC × LCC cross-classification flows" },
    { id: "confusion", label: "Cross-Tab Table", description: "Tabular cross-classification counts" },
    { id: "grouped-bar", label: "Grouped Bar", description: "LCC distribution per DDC main class" },
  ],
  grammar: [
    { id: "sankey", label: "Sankey Flow", description: "7-stage flow: Depth → Mood → Syntax → Action → Tone → Form → DDC" },
    { id: "stacked-bar", label: "Stacked Bar", description: "Grammar category distribution per stage" },
    { id: "timeline", label: "Timeline Evolution", description: "Grammar ring distribution shifts over chronological time" },
  ],
  "mood-intent": [
    { id: "chord", label: "Chord Diagram", description: "Mood-to-intent flows" },
    { id: "confusion", label: "Confusion Matrix", description: "Mood × Intent density grid" },
    { id: "grouped-bar", label: "Grouped Bar", description: "Intent distribution per mood" },
  ],
  memory: [
    { id: "grounding", label: "Entropy by Chunk Usage", description: "Response token entropy conditioned on used/discarded/absent memory chunks" },
  ],
  distribution: [
    { id: "celestial", label: "Celestial Scatter", description: "Traces plotted by duration vs prompt length" },
    { id: "histogram", label: "Duration Histogram", description: "Latency distribution across traces" },
    { id: "timeline", label: "Timeline", description: "Trace duration over chronological time" },
  ],
  personality: [
    { id: "cards", label: "Profile Cards", description: "Per-model detailed statistics" },
    { id: "radar", label: "Radar Comparison", description: "Multi-model radar overlay" },
    { id: "bar", label: "Model Bar Chart", description: "Side-by-side model metrics" },
  ],
};

export const DEFAULT_CHART: Record<string, string> = {
  synesthesia: "confusion",
  drift: "chord",
  cross: "chord",
  grammar: "sankey",
  "mood-intent": "chord",
  memory: "grounding",
  distribution: "celestial",
  personality: "cards",
};
