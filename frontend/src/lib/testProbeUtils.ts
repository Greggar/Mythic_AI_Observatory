import type { TraceSession, Probe, ProbeResult } from "@/types/trace";

export function extractProbeResults(trace: TraceSession, probes: Probe[]): ProbeResult[] {
  return probes.map((p) => {
    const artefactLabel = p.artefact === "prompt" ? "Prompt" : "Output";
    const label = `${PROBE_ATTR_LABEL(p.attribute)} (${artefactLabel})`;

    switch (p.attribute) {
      case "ddc": {
        const entry = p.artefact === "prompt" ? trace.ddc?.prompt : trace.ddc?.response;
        return {
          label,
          value: entry ? `${entry.code} ${entry.label}` : "—",
          confidence: entry?.score ?? null,
        };
      }
      case "lcc": {
        const entry = p.artefact === "prompt" ? trace.lcc?.prompt : trace.lcc?.response;
        return {
          label,
          value: entry ? `${entry.code} ${entry.label}` : "—",
          confidence: entry?.score ?? null,
        };
      }
      case "intent": {
        const step = trace.steps?.find((s) => s.id === "step-2");
        const probs = step?.metadata?.intent_probs as Array<{ label: string; confidence: number }> | undefined;
        if (probs && probs.length > 0) {
          const top = probs[0];
          return {
            label,
            value: `${top.label} (${(top.confidence * 100).toFixed(0)}%)`,
            confidence: top.confidence,
          };
        }
        return { label, value: "—", confidence: null };
      }
      case "synesth_input": {
        const s = trace.synesth;
        if (s?.input_probs) {
          const labels = ["Direct Command", "Factual Question", "Creative Request", "Simple Query", "Complex Inquiry"];
          const maxIdx = s.input_probs.indexOf(Math.max(...s.input_probs));
          const score = s.input_probs[maxIdx];
          return {
            label,
            value: score >= 0.1 ? labels[maxIdx] : "—",
            confidence: score >= 0.1 ? score : null,
          };
        }
        return { label, value: "—", confidence: null };
      }
      case "synesth_output": {
        const s = trace.synesth;
        if (s?.output_probs) {
          const labels = ["Concise List/Facts", "Prose Explanation", "Creative/Verse", "Bulleted List", "Technical/Code"];
          const maxIdx = s.output_probs.indexOf(Math.max(...s.output_probs));
          const score = s.output_probs[maxIdx];
          return {
            label,
            value: score >= 0.1 ? labels[maxIdx] : "—",
            confidence: score >= 0.1 ? score : null,
          };
        }
        return { label, value: "—", confidence: null };
      }
      default:
        return { label, value: "—", confidence: null };
    }
  });
}

function PROBE_ATTR_LABEL(attr: string): string {
  const map: Record<string, string> = {
    ddc: "DDC",
    lcc: "LCC",
    intent: "Intent",
    synesth_input: "Synesthesia Input",
    synesth_output: "Synesthesia Output",
  };
  return map[attr] || attr;
}

export function probesToDescription(probes: Probe[]): string {
  return probes.map((p) => {
    const attr = PROBE_ATTR_LABEL(p.attribute);
    const artefact = p.artefact === "prompt" ? "Prompt" : "Output";
    return `${attr} (${artefact})`;
  }).join(" + ");
}

export function exportTestMatrixCSV(
  rows: { modelLabel: string; traceId: string; results: ProbeResult[] }[]
): string {
  if (rows.length === 0) return "";
  const probeLabels = rows[0].results.map((r) => r.label);
  const header = ["Trace ID", "Model", ...probeLabels.flatMap((l) => [`${l} (Value)`, `${l} (Confidence)`])];
  const lines = rows.map((row) => {
    const cells = [row.traceId, row.modelLabel];
    for (const r of row.results) {
      cells.push(r.value);
      cells.push(r.confidence !== null ? r.confidence.toFixed(4) : "—");
    }
    return cells.map((c) => `"${c}"`).join(",");
  });
  return [header.join(","), ...lines].join("\n");
}
