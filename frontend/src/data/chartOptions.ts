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
  ],
  drift: [
    { id: "chord", label: "Chord Diagram", description: "DDC category shifts from prompt to response" },
    { id: "confusion", label: "Confusion Matrix", description: "Prompt DDC × Response DDC transition counts" },
    { id: "heatmap", label: "Temporal Heatmap", description: "DDC digit density over time" },
    { id: "scatter", label: "Scatter Plot", description: "Prompt vs response DDC digit distribution" },
  ],
  cross: [
    { id: "chord", label: "Chord Diagram", description: "DDC × LCC cross-classification flows" },
    { id: "confusion", label: "Cross-Tab Table", description: "Tabular cross-classification counts" },
    { id: "grouped-bar", label: "Grouped Bar", description: "LCC distribution per DDC main class" },
  ],
  intonation: [
    { id: "chord", label: "Chord Diagram", description: "Tone-to-length relationships" },
    { id: "radar", label: "Radar", description: "Multi-dimensional tone profile" },
    { id: "stacked-bar", label: "Stacked Bar", description: "Tone distribution by length bucket" },
  ],
  grammar: [
    { id: "rings", label: "Radial Ring Progression", description: "6-ring concentric grammar pipeline" },
    { id: "sankey", label: "Sankey Flow", description: "7-stage flow: Depth → Mood → Syntax → Action → Tone → Form → DDC" },
    { id: "stacked-bar", label: "Stacked Bar", description: "Grammar category distribution per stage" },
  ],
  "mood-intent": [
    { id: "chord", label: "Chord Diagram", description: "Mood-to-intent flows" },
    { id: "confusion", label: "Confusion Matrix", description: "Mood × Intent density grid" },
    { id: "grouped-bar", label: "Grouped Bar", description: "Intent distribution per mood" },
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
  intonation: "chord",
  grammar: "rings",
  "mood-intent": "chord",
  distribution: "celestial",
  personality: "cards",
};
