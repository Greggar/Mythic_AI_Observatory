"use client";

import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { arc as d3Arc, chord as d3Chord, Chord } from "d3";
import { createPortal } from "react-dom";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
const W = 420;
const H = 420;
const CX = W / 2;
const CY = H / 2;
const RIM = 125;
const LABEL_R = 152;
const INNER = 40;
const PAD_ANGLE = 0.04;

type RelType = "synesthesia" | "drift" | "cross" | "intonation" | "grammar" | "mood-intent";

interface IntentProb {
  label: string;
  confidence: number;
  reasoning?: string;
}

interface TraceStep {
  id: string;
  label: string;
  metadata: Record<string, unknown>;
}

interface TraceData {
  id: string;
  prompt: string;
  output: string | null;
  steps?: TraceStep[];
  model_used?: string | null;
  ddc?: { prompt?: { code?: string; action?: string } | null; response?: { code?: string } | null } | null;
  lcc?: { prompt?: { code?: string } | null } | null;
}

function polar(cx: number, cy: number, r: number, a: number): [number, number] {
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

const safe = (a: number) => (isNaN(a) || !isFinite(a) ? 0 : a);
const arcGen = d3Arc();
const chordLayout = d3Chord().padAngle(PAD_ANGLE).sortGroups(null);

// ── Synesthesia (Prompt/Response Type) ──────────────────
const SYN_INPUT_COLORS = ["#60a5fa", "#f472b6", "#34d399", "#a78bfa", "#fb923c"];
const SYN_OUTPUT_COLORS = ["#60a5fa", "#f472b6", "#34d399", "#a78bfa", "#fb923c"];
const SYN_INPUT_LABELS = [
  "Direct Command",
  "Factual Question",
  "Creative Request",
  "Simple Query",
  "Complex Inquiry",
];
const SYN_OUTPUT_LABELS = [
  "Concise List/Facts",
  "Prose Explanation",
  "Creative/Verse",
  "Bulleted List",
  "Technical/Code",
];

function classifySynesthesiaPrompt(prompt: string): number {
  const text = prompt.trim();
  const lower = text.toLowerCase();
  const wordCount = text.split(/\s+/).length;

  const isCommand = /^(list|write|tell|show|give|create|build|find|explain|describe|summarize|generate|make|name|enumerate|state|define|compile|produce|draft|compose|prepare)\b/i.test(text);
  const isQuestion = text.endsWith("?") || /^(what|how|why|where|when|which|who|whose|could|would|should|can|will|do|does|did|is|are|was|were)\b/i.test(lower);
  const isCreative = /\b(sonnet|poem|poetry|verse|lyric|story|tale|narrative|metaphor|imagine|creative|song|ballad|haiku|limerick|ode|elegy|prose|fiction|fantasy|sci-fi|fable|myth)\b/i.test(lower);

  // Creative Request: explicit creative keywords regardless of phrasing
  if (isCreative) return 2;
  // Factual Question: interrogative form seeking information
  if (isQuestion) return 1;
  // Direct Command: imperative action verb at start
  if (isCommand) return 0;
  // Complex Inquiry: long, multi-sentence
  if (wordCount > 12) return 4;
  // Simple Query: short, no strong signal
  return 3;
}

function classifySynesthesiaResponse(text: string): number {
  if (!text) return 0;
  const wordCount = text.split(/\s+/).length;
  const lower = text.toLowerCase();
  const lines = text.split("\n").filter(l => l.trim().length > 0);
  const lineCount = lines.length;
  const avgLineLen = lineCount > 0 ? wordCount / lineCount : 0;

  // Code
  if (/```/.test(text)) return 4;

  // Bulleted or numbered list
  const hasBullets = /^[-*\u2022]\s/m.test(text);
  const hasNumbers = /^\d+[.)]\s/m.test(text);
  if (hasBullets || hasNumbers) return 3;

  // Colon-formatted list: "Name: value" repeated 3+ times
  const colonListLines = lines.filter(l => /^[A-Z][a-zA-Z\s]+:\s/u.test(l.trim()));
  if (colonListLines.length >= 3) return 3;

  // Verse: 8+ short lines (avg < 12 words), no single long line
  const longLines = lines.filter(l => l.split(/\s+/).length > 16);
  if (avgLineLen < 12 && lineCount >= 8 && longLines.length < 3) return 2;

  // Enumeration in prose: "first... second... third" or "X: Y, Z: W"
  const hasEnumeration = /\b(first|second|third|fourth|fifth|one:|two:|three:)\b/i.test(lower) ||
    (lines.filter(l => /[A-Z][a-z]+:\s+[A-Z]/.test(l)).length >= 3);
  if (hasEnumeration || wordCount < 30) return 0;

  // Prose explanation: longer paragraph form
  return 1;
}

function buildSynesthesiaMatrix(traces: TraceData[]): number[][] {
  const N = 10;
  const M = Array.from({ length: N }, () => Array(N).fill(0));
  for (const t of traces) {
    const inputCat = classifySynesthesiaPrompt(t.prompt);
    const outputCat = classifySynesthesiaResponse(t.output || "");
    M[inputCat][5 + outputCat] += 1;
    M[5 + outputCat][inputCat] += 1;
  }
  return M;
}

// ── Semantic Drift ──────────────────────────────────────
const DDC_COLORS = ["#6b7280", "#a78bfa", "#f87171", "#60a5fa", "#34d399", "#fbbf24", "#f472b6", "#fb923c", "#818cf8", "#2dd4bf"];
const DDC_SHORT = ["Gen", "Phil", "Rel", "Soc", "Lang", "Sci", "Tech", "Art", "Lit", "Hist"];

function buildDriftMatrix(traces: TraceData[]): number[][] {
  const N = 20;
  const M = Array.from({ length: N }, () => Array(N).fill(0));
  for (const t of traces) {
    const pc = t.ddc?.prompt?.code?.[0];
    const rc = t.ddc?.response?.code?.[0];
    if (pc && rc) {
      const pi = parseInt(pc);
      const ri = parseInt(rc);
      if (!isNaN(pi) && !isNaN(ri)) {
        M[pi][10 + ri] += 1;
        M[10 + ri][pi] += 1;
      }
    }
  }
  return M;
}

// ── Cross (DDC × LCC) ──────────────────────────────────
const CROSS_LCC_ORDER = ["A", "B", "C", "D", "G", "H", "J", "N", "P", "Q", "R", "T", "U", "V", "Z"];
const CROSS_LCC_NAMES: Record<string, string> = {
  A: "General Works", B: "Phil & Rel", C: "History", D: "World History",
  G: "Geo & Anthro", H: "Soc Sci", J: "Pol Sci", N: "Arts",
  P: "Lang & Lit", Q: "Sciences", R: "Medicine", T: "Technology",
  U: "Military", V: "Naval", Z: "Bibliog",
};
const CROSS_LCC_COLORS: Record<string, string> = {
  A: "#8b5cf6", B: "#ec4899", C: "#f97316", D: "#eab308",
  G: "#22c55e", H: "#06b6d4", J: "#6366f1", N: "#d946ef",
  P: "#14b8a6", Q: "#f43f5e", R: "#0ea5e9", T: "#a855f7",
  U: "#78716c", V: "#57534e", Z: "#a1a1aa",
};

function buildCrossMatrix(traces: TraceData[]): number[][] {
  const nLcc = CROSS_LCC_ORDER.length;
  const N = 10 + nLcc;
  const M = Array.from({ length: N }, () => Array(N).fill(0));
  for (const t of traces) {
    const dc = t.ddc?.prompt?.code?.[0];
    const lc = t.lcc?.prompt?.code?.[0];
    if (dc && lc) {
      const di = parseInt(dc);
      const li = CROSS_LCC_ORDER.indexOf(lc.toUpperCase());
      if (!isNaN(di) && li !== -1) {
        M[di][10 + li] += 1;
        M[10 + li][di] += 1;
      }
    }
  }
  return M;
}

// ── Prompt Intonation ────────────────────────────────────
const INTON_INPUT_LABELS = ["Imperative", "Socratic", "Skeptical", "Ambiguous"];
const INTON_INPUT_COLORS = ["#34d399", "#60a5fa", "#f87171", "#a78bfa"];
const INTON_OUTPUT_LABELS = ["Very Low", "Low", "Medium", "High", "Very High"];
const INTON_OUTPUT_COLORS = ["#34d399", "#60a5fa", "#fbbf24", "#f472b6", "#f87171"];

function classifyIntonation(prompt: string): number {
  const SKEPTICAL = /\b(are you sure|that'?s (wrong|incorrect)|prove|incorrect|i (don't think|disagree|doubt)|but actually|you (didn't|failed|should have)|explain (why|yourself))\b/i;
  const SOCRATIC = /^(how|what|why|what if|how would|could you|i wonder|what are the|is there)\b/i;
  const text = prompt.trim();
  if (!text) return 3;
  if (SKEPTICAL.test(text)) return 2;
  if (SOCRATIC.test(text) || text.endsWith("?")) return 1;
  if (text.length < 25) return 3;
  return 0;
}

function buildIntonationMatrix(traces: TraceData[]): number[][] {
  const N = 4 + 5;
  const M = Array.from({ length: N }, () => Array(N).fill(0));
  for (const t of traces) {
    const cat = classifyIntonation(t.prompt);
    const len = (t.output || "").length;
    const bucket = len < 100 ? 0 : len < 300 ? 1 : len < 700 ? 2 : len < 1500 ? 3 : 4;
    M[cat][4 + bucket] += 1;
    M[4 + bucket][cat] += 1;
  }
  return M;
}

// ── Mood × Intent ─────────────────────────────────────────
const INTENT_SUPER_LABELS = ["Creative", "Privacy & System", "Casual", "Technical", "Info Seeking", "Other"];
const INTENT_SUPER_COLORS = ["#f472b6", "#818cf8", "#34d399", "#f97316", "#60a5fa", "#6b7280"];

function intentToSuper(label: string): string {
  const l = label.toLowerCase();
  if (/(poem|ode|lyric|creative|literary|joke|poetry)/i.test(l)) return "Creative";
  if (/(privacy|policy|data_storage|account_access|private_message|file_format|communication_record|previous_message|interaction_history|information_management)/i.test(l)) return "Privacy & System";
  if (/(greeting|no_intention)/i.test(l)) return "Casual";
  if (/(techni|software|functionality|model_management|system_information)/i.test(l)) return "Technical";
  if (/(question|query|fact|curios|explain|define|educate|trivia|information|knowledge|astronomy|history|geograph|nature|insect|entomolog|scientific|color_sci|feature_benefits|general_request|request_information|customer)/i.test(l)) return "Info Seeking";
  return "Other";
}

function buildMoodIntentSuperMatrix(traces: TraceData[]): number[][] {
  const N = 5 + INTENT_SUPER_LABELS.length;
  const M = Array.from({ length: N }, () => Array(N).fill(0));
  for (const t of traces) {
    const moodIdx = classifyMood5(t.prompt);
    const step = t.steps?.find(s => s.label === "Intent Classification");
    const intentProbs = step?.metadata?.intent_probs;
    if (Array.isArray(intentProbs)) {
      for (const ip of intentProbs) {
        if (ip && typeof ip.label === "string") {
          const superLabel = intentToSuper(ip.label);
          const superIdx = INTENT_SUPER_LABELS.indexOf(superLabel);
          if (superIdx !== -1) {
            M[moodIdx][5 + superIdx] += 1;
            M[5 + superIdx][moodIdx] += 1;
          }
        }
      }
    }
  }
  return M;
}

// ── 6-Ring Synesthesia Schema (Prompt→Response) ────────────
const DEPTH_LABELS = ["Interjection", "Minor Sentence", "Full Verb Phrase"];
const DEPTH_COLORS = ["#f472b6", "#fbbf24", "#a78bfa"];
const MOOD5_LABELS = ["Imperative", "Indicative", "Interrogative", "Conditional", "Subjunctive"];
const MOOD5_COLORS = ["#ef4444", "#3b82f6", "#f59e0b", "#8b5cf6", "#10b981"];
const SYNTAX3_LABELS = ["Simple", "Compound", "Complex"];
const SYNTAX3_COLORS = ["#34d399", "#f97316", "#f472b6"];
const ACTION_LABELS = ["Direct Execution", "Conversational Phatic", "Refusal/Guardrail"];
const ACTION_COLORS = ["#06b6d4", "#f59e0b", "#ef4444"];
const TONE_LABELS = ["Informative", "Instructional", "Entertainment", "Creative", "Analytical", "Corrective"];
const TONE_COLORS = ["#6366f1", "#22c55e", "#fcd34d", "#ec4899", "#f97316", "#8b5cf6"];
const FORM_LABELS = ["Structured (Code/Tables)", "Bulleted/Fragmented", "Continuous Prose", "Verse"];
const FORM_COLORS = ["#a855f7", "#eab308", "#34d399", "#f472b6"];

function hasInterjection(text: string): boolean {
  return /^(Oh|Wow|Please|Ah|Hey|Alas|Ooh|Aha|Oops|Ugh|Yay|Hmm|Well)\b/i.test(text.trim());
}

function isMinorSentence(text: string): boolean {
  const t = text.trim();
  return /^(Hello|Hi|Hey|Yes|No|Thanks|Thank you|Goodbye|Bye|Sure|Okay|OK|Fine|Great|Awesome|Perfect|Help|Why not|Of course|Never mind|Got it|Right|Absolutely|Exactly|Agreed|Good|Alright|Bye)\s*[.!?]?\s*$/i.test(t) || t.split(/\s+/).length <= 3;
}

function classifyDepth(prompt: string): number {
  if (hasInterjection(prompt)) return 0;
  if (isMinorSentence(prompt)) return 1;
  return 2;
}

function classifyMood5(prompt: string): number {
  const t = prompt.trim();
  if (!t) return 0;
  if (/^(if|when|whenever|should|unless|provided that|assuming|given that)\b/i.test(t) || /\b(if .+ then|if you|when you|unless you)\b/i.test(t)) return 3;
  if (/^(act as|imagine|pretend|suppose|picture|consider what if|what would|what if)\b/i.test(t) || /\b(as if|as though|act like|speak as|role.?play)\b/i.test(t)) return 4;
  if (t.endsWith("?") || /^(what|how|why|where|when|which|could|would|should|can|do|does|is|are|will)\b/i.test(t)) return 2;
  if (/^(the|this|that|there|it|we|they|he|she|i)\b/i.test(t) || /^[A-Z]/.test(t)) return 1;
  return 0;
}

function classifySyntax(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  const coordConj = /\b(and|but|or|yet|so|for|nor)\b/i;
  const subordConj = /\b(because|although|while|since|unless|if|when|whereas|though|as|until|after|before|once|that|which|who|whom|whose|where|when|why|how)\b/i;
  const clauses = t.split(/[.!?]+/).filter(Boolean);
  const hasCoord = coordConj.test(t);
  const hasSubord = subordConj.test(t);
  if (hasSubord || (clauses.length > 1 && hasCoord)) return 2;
  if (hasCoord || clauses.length > 1) return 1;
  return 0;
}

function classifyActionType(response: string): number {
  if (!response) return 1;
  const r = response.trim();
  if (/^(i'?m (sorry|unable|cannot|can'?t|not able|not designed)|i cannot|i can'?t|as an ai|i don'?t have|i do not have|i apologize|unable to|cannot fulfill|cannot provide|i must|i should not|that'?s beyond|that is beyond)/i.test(r)) return 2;
  if (/^(sure|okay|ok|of course|happy to|gladly|certainly|absolutely|yes|here'?s|here is|here are|i'?ll|let me|i can|i will)\b/i.test(r) || /```/.test(r) || r.length < 30) return 0;
  return 1;
}

function classifyPragmaticTone(response: string): number {
  if (!response) return 0;
  // Entertainment: humor, playfulness, verse
  if (/\b(joke|humor|funny|silly|amusing|hilarious|playful|limerick|light.?hearted|haiku|sonnet|limerick)\b/i.test(response)) return 2;
  // Creative: evocative, poetic, artistic
  if (/\b(metaphor|imagine|picture|evocative|vivid|story|poem|poetic|beautiful|art|artistic|aesthetic|mood|atmosphere|shadow|light|breathtaking|sublime|dream|dreamlike|surreal)\b/i.test(response)) return 3;
  // Analytical
  if (/\b(however|therefore|thus|consequently|furthermore|analysis|analyze|examine|compare|contrast|perspective|lens|dimension|factor|parameter|framework|paradigm)\b/i.test(response)) return 4;
  // Corrective
  if (/\b(warning|caution|careful|be careful|note that|important|critical|you should|you need to|make sure|ensure|remember to|don'?t forget|must|should not|incorrect|wrong|mistake|error|flaw|issue|problem|never)\b/i.test(response)) return 5;
  // Instructional
  if (/\b(step|follow|instructions|how to|guide|tutorial|walkthrough|do this|you can|you will|start by|begin by|first|next|then|finally|procedure|process)\b/i.test(response)) return 1;
  return 0;
}

function classifyOutputForm(response: string): number {
  if (!response) return 2;
  if (/```/.test(response) || /\|.*\|.*\|/.test(response) || /^#{1,6}\s/m.test(response)) return 0;
  if (/^[-*]\s/m.test(response) || /^\d+\.\s/m.test(response)) return 1;
  // Verse detection: short, multi-line structure without prose flow
  const lines = response.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length >= 3) {
    const avgLen = lines.reduce((s, l) => s + l.length, 0) / lines.length;
    const maxLen = Math.max(...lines.map(l => l.length));
    if (avgLen < 55 && maxLen < 80) return 3;
  }
  return 2;
}

function cleanResponse(text: string): string {
  return text.replace(/^\[.*?\]:\s*/, "");
}

// ── 6-Ring Tree Building ─────────────────────────────────
interface SynesthNode {
  label: string;
  count: number;
  color: string;
  children?: SynesthNode[];
  startAngle?: number;
  endAngle?: number;
}

const RING_COLORS = [DEPTH_COLORS, MOOD5_COLORS, SYNTAX3_COLORS, ACTION_COLORS, TONE_COLORS, FORM_COLORS];

const RING_SPECS_6 = [
  { inner: 16, outer: 32, label: "Depth" },
  { inner: 38, outer: 58, label: "Mood" },
  { inner: 64, outer: 76, label: "Syntax" },
  { inner: 84, outer: 114, label: "Action" },
  { inner: 120, outer: 150, label: "Tone" },
  { inner: 156, outer: 196, label: "Form" },
];

const LEVEL_LABELS = [DEPTH_LABELS, MOOD5_LABELS, SYNTAX3_LABELS, ACTION_LABELS, TONE_LABELS, FORM_LABELS];
const CLASSIFIERS = [classifyDepth, classifyMood5, classifySyntax, classifyActionType, classifyPragmaticTone, classifyOutputForm];

function nodeColor(depth: number, catIdx: number): string {
  const colors = RING_COLORS[depth];
  return colors?.[catIdx] ?? "#6b7280";
}

function ensureChild(parent: SynesthNode, label: string, count: number, depth: number, catIdx: number): SynesthNode {
  let child = parent.children?.find(n => n.label === label);
  if (!child) {
    child = { label, count: 0, color: nodeColor(depth, catIdx), children: [] };
    if (!parent.children) parent.children = [];
    parent.children.push(child);
  }
  child.count += count;
  return child;
}

function buildSynesthTree(traces: TraceData[]): SynesthNode {
  const pathMap = new Map<string, number>();
  for (const t of traces) {
    const cats = CLASSIFIERS.map(fn => fn(t.prompt));
    const responseCats = CLASSIFIERS.slice(3).map(fn => fn(cleanResponse(t.output || "")));
    const key = [...cats, ...responseCats].join(",");
    pathMap.set(key, (pathMap.get(key) || 0) + 1);
  }

  const root: SynesthNode = { label: "All Traces", count: traces.length, color: "#2dd4bf", children: [] };
  for (const [key, count] of pathMap) {
    const parts = key.split(",").map(Number);
    let node = root;
    for (let d = 0; d < 6; d++) {
      // Rings 0-2 (Depth, Mood, Syntax) use prompt classifiers (parts[0..2])
      // Rings 3-5 (Action, Tone, Form) use response classifiers (parts[6..8])
      const catIdx = d < 3 ? parts[d] : parts[d + 3];
      const label = LEVEL_LABELS[d][catIdx];
      const parent = node;
      node = ensureChild(parent, label, count, d, catIdx);
    }
  }
  layoutSunburst(root, 0, Math.PI * 2, -Math.PI / 2);
  return root;
}

function layoutSunburst(node: SynesthNode, start: number, span: number, origin: number) {
  node.startAngle = origin + start;
  node.endAngle = origin + start + span;
  if (!node.children || node.children.length === 0) return;
  let running = 0;
  for (const child of node.children) {
    const childSpan = (child.count / node.count) * span;
    layoutSunburst(child, running, childSpan, origin + start);
    running += childSpan;
  }
}

function getGrammarPaths(traces: TraceData[]): { paths: string; labels_in: string; labels_out: string } {
  const pathCounts = new Map<string, number>();
  for (const t of traces) {
    const depth = classifyDepth(t.prompt);
    const mood = classifyMood5(t.prompt);
    const syntax = classifySyntax(t.prompt);
    const action = classifyActionType(t.output || "");
    const tone = classifyPragmaticTone(t.output || "");
    const form = classifyOutputForm(t.output || "");
    const path = `${DEPTH_LABELS[depth]} → ${MOOD5_LABELS[mood]} → ${SYNTAX3_LABELS[syntax]} → ${ACTION_LABELS[action]} → ${TONE_LABELS[tone]} → ${FORM_LABELS[form]}`;
    pathCounts.set(path, (pathCounts.get(path) || 0) + 1);
  }
  const sorted = [...pathCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const paths = sorted.map(([path, count]) => `  ${count}×  ${path}`).join("\n");
  return {
    paths,
    labels_in: DEPTH_LABELS.join(", ") + "; " + MOOD5_LABELS.join(", ") + "; " + SYNTAX3_LABELS.join(", "),
    labels_out: ACTION_LABELS.join(", ") + "; " + TONE_LABELS.join(", ") + "; " + FORM_LABELS.join(", "),
  };
}

// ── Configs ──────────────────────────────────────────────
const REL_CONFIGS: Record<RelType, {
  title: string;
  description: string;
  inputLabels: string[];
  outputLabels: string[];
  inputColors: string[];
  outputColors: string[];
  buildMatrix: (t: TraceData[]) => number[][];
}> = {
  synesthesia: {
    title: "Cognitive Synesthesia",
    description: "Maps the relationship between the nature of the user's prompt and the resulting model persona. How does what we say warp how the model behaves?",
    inputLabels: SYN_INPUT_LABELS,
    outputLabels: SYN_OUTPUT_LABELS,
    inputColors: SYN_INPUT_COLORS,
    outputColors: SYN_OUTPUT_COLORS,
    buildMatrix: buildSynesthesiaMatrix,
  },
  drift: {
    title: "Semantic Drift",
    description: "Traces how the topic shifts between prompt and response. When you ask about one subject, does the model answer in the same domain or drift elsewhere?",
    inputLabels: DDC_SHORT.map((n) => `P:${n}`),
    outputLabels: DDC_SHORT.map((n) => `R:${n}`),
    inputColors: DDC_COLORS,
    outputColors: DDC_COLORS,
    buildMatrix: buildDriftMatrix,
  },
  cross: {
    title: "DDC × LCC Cross-Classification",
    description: "Maps how the two classifiers align for the same prompt. Do DDC and LCC agree on the main subject, or do they systematically diverge?",
    inputLabels: DDC_SHORT.map((n) => `D:${n}`),
    outputLabels: CROSS_LCC_ORDER.map((l) => `L:${CROSS_LCC_NAMES[l]}`),
    inputColors: DDC_COLORS,
    outputColors: CROSS_LCC_ORDER.map((l) => CROSS_LCC_COLORS[l] || "#374151"),
    buildMatrix: buildCrossMatrix,
  },
  intonation: {
    title: "Prompt Intonation",
    description: "Groups prompts by linguistic tone — imperative commands, Socratic questions, skeptical challenges, or ambiguous fragments — and maps them to output length (Very Low <100, Low 100-300, Medium 300-700, High 700-1500, Very High >1500 chars). Does the model over-defend when challenged?",
    inputLabels: INTON_INPUT_LABELS,
    outputLabels: INTON_OUTPUT_LABELS,
    inputColors: INTON_INPUT_COLORS,
    outputColors: INTON_OUTPUT_COLORS,
    buildMatrix: buildIntonationMatrix,
  },
  grammar: {
    title: "6-Ring Synesthesia Schema",
    description: "Maps the full stimulus→sensation pipeline: prompt Depth → Mood → Syntax (inner rings) → response Action → Tone → Form (outer rings). Color-bled by mood family.",
    inputLabels: [],
    outputLabels: [],
    inputColors: [],
    outputColors: [],
    buildMatrix: () => [],
  },
  "mood-intent": {
    title: "Mood × Intent",
    description: "Cross-references prompt mood (regex-classified) against the LLM's intent classification tokens (clustered into 6 supercategories). Do imperatives produce different intent patterns than interrogatives?",
    inputLabels: MOOD5_LABELS,
    outputLabels: INTENT_SUPER_LABELS,
    inputColors: MOOD5_COLORS,
    outputColors: INTENT_SUPER_COLORS,
    buildMatrix: buildMoodIntentSuperMatrix,
  },
};

interface Props {
  refreshTrigger?: number;
}

export default function RelationshipsPanel({ refreshTrigger = 0 }: Props) {
  const [traces, setTraces] = useState<TraceData[]>([]);
  const [relType, setRelType] = useState<RelType>("synesthesia");
  const [hoveredChord, setHoveredChord] = useState<{ source: number; target: number; count: number; sx: number; sy: number } | null>(null);
  const [selectedModel, setSelectedModel] = useState("all");
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analysisModel, setAnalysisModel] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    setAnalysis(null);
    setAnalysisModel(null);
  }, [relType, selectedModel]);
  const containerRef = useRef<HTMLDivElement>(null);

  const cfg = REL_CONFIGS[relType];

  const availableModels = useMemo(() => {
    const set = new Set<string>();
    for (const t of traces) {
      if (t.model_used) set.add(t.model_used);
    }
    return Array.from(set).sort();
  }, [traces]);

  const filteredTraces = useMemo(
    () => selectedModel === "all" ? traces : traces.filter((t) => t.model_used === selectedModel),
    [traces, selectedModel]
  );

  const isMoodIntent = relType === "mood-intent";

  const moodIntentLabels = useMemo(() => isMoodIntent ? {
    inputLabels: MOOD5_LABELS,
    outputLabels: INTENT_SUPER_LABELS,
    inputColors: MOOD5_COLORS,
    outputColors: INTENT_SUPER_COLORS,
  } : null, [isMoodIntent]);

  const allLabels = useMemo(() => {
    if (moodIntentLabels) return [...moodIntentLabels.inputLabels, ...moodIntentLabels.outputLabels];
    return [...cfg.inputLabels, ...cfg.outputLabels];
  }, [cfg, moodIntentLabels]);

  const nodeColors = useMemo(() => {
    if (moodIntentLabels) return [...moodIntentLabels.inputColors, ...moodIntentLabels.outputColors];
    return [...cfg.inputColors, ...cfg.outputColors];
  }, [cfg, moodIntentLabels]);

  const legendInputLabels = moodIntentLabels?.inputLabels ?? cfg.inputLabels;
  const legendInputColors = moodIntentLabels?.inputColors ?? cfg.inputColors;
  const legendOutputLabels = moodIntentLabels?.outputLabels ?? cfg.outputLabels;
  const legendOutputColors = moodIntentLabels?.outputColors ?? cfg.outputColors;
  const legendSideLeft = isMoodIntent ? "MOOD" : relType === "synesthesia" ? "INPUT →" : relType === "cross" ? "DDC" : relType === "intonation" ? "INTONATION" : "PROMPT";
  const legendSideRight = isMoodIntent ? "INTENT" : relType === "synesthesia" ? "OUTPUT" : relType === "cross" ? "LCC" : relType === "intonation" ? "TOKENS" : "RESPONSE";

  const fetchTraces = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/traces?limit=200`);
      if (!res.ok) return;
      setTraces(await res.json() as TraceData[]);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchTraces(); }, [fetchTraces, refreshTrigger]);

  const matrix = useMemo(() => {
    if (relType === "grammar") return [];
    return cfg.buildMatrix(filteredTraces);
  }, [filteredTraces, cfg, relType]);

  const chords = useMemo(() => {
    if (relType === "grammar" || matrix.length === 0) return null;
    return chordLayout(matrix as number[][]);
  }, [matrix, relType]);

  const topRelationships = useMemo(() => {
    if (relType === "grammar") return [];
    const pairs: { src: number; tgt: number; count: number }[] = [];
    const nInput = moodIntentLabels?.inputLabels.length ?? cfg.inputLabels.length;
    const nOutput = moodIntentLabels?.outputLabels.length ?? cfg.outputLabels.length;
    const m = matrix as number[][];
    for (let i = 0; i < nInput; i++) {
      for (let j = 0; j < nOutput; j++) {
        const count = m[i]?.[nInput + j] ?? 0;
        if (count > 0) pairs.push({ src: i, tgt: nInput + j, count });
      }
    }
    return pairs.sort((a, b) => b.count - a.count).slice(0, 5);
  }, [matrix, cfg, relType, moodIntentLabels]);

  const runAnalysis = useCallback(async () => {
    if (analyzing) return;
    if (relType !== "grammar" && matrix.length === 0) return;
    if (relType === "grammar" && filteredTraces.length < 3) return;
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const rawSamples = filteredTraces
        .filter(t => t.output)
        .slice(0, 10)
        .map((t, i) => `=== Trace ${i + 1} ===\nPrompt: ${t.prompt}\nResponse: ${t.output}`)
        .join("\n\n");
      let body: Record<string, unknown>;
      if (relType === "grammar") {
        const gp = getGrammarPaths(filteredTraces);
        body = {
          rel_type: "grammar",
          title: cfg.title,
          description: cfg.description,
          input_labels: [],
          output_labels: [],
          top_relationships: [],
          total_traces: filteredTraces.length,
          paths: gp.paths,
          samples: rawSamples,
        };
      } else {
        const pairs = topRelationships.map(r => ({
          src: allLabels[r.src],
          tgt: allLabels[r.tgt],
          count: r.count,
        }));
        body = {
          rel_type: relType,
          title: cfg.title,
          description: cfg.description,
          input_labels: legendInputLabels,
          output_labels: legendOutputLabels,
          top_relationships: pairs,
          total_traces: filteredTraces.length,
          samples: rawSamples,
        };
      }
      const res = await fetch(`${API_BASE}/api/analyze/relationships`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.response || `HTTP ${res.status}`);
      setAnalysis(data.response);
      setAnalysisModel(data.model || null);
    } catch (err) {
      setAnalysis(`Analysis request failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      setAnalysisModel(null);
    } finally {
      setAnalyzing(false);
    }
  }, [analyzing, matrix, topRelationships, allLabels, cfg, relType, legendInputLabels, legendOutputLabels, filteredTraces]);

  const grammarData = useMemo(() => {
    if (relType !== "grammar") return null;
    return buildSynesthTree(filteredTraces);
  }, [filteredTraces, relType]);

  const handleGrammarExport = useCallback((ring: number, label: string) => {
    const catIdx = LEVEL_LABELS[ring].indexOf(label);
    if (catIdx === -1) return;
    const matching = filteredTraces.filter(t => {
      const c = CLASSIFIERS[ring](ring < 3 ? t.prompt : (t.output || ""));
      return c === catIdx;
    });
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = ['"prompt","depth","mood","syntax","action","tone","form"'];
    for (const t of matching) {
      const d = DEPTH_LABELS[classifyDepth(t.prompt)];
      const m = MOOD5_LABELS[classifyMood5(t.prompt)];
      const s = SYNTAX3_LABELS[classifySyntax(t.prompt)];
      const a = ACTION_LABELS[classifyActionType(t.output || "")];
      const to = TONE_LABELS[classifyPragmaticTone(t.output || "")];
      const f = FORM_LABELS[classifyOutputForm(t.output || "")];
      lines.push(`${esc(t.prompt)},${esc(d)},${esc(m)},${esc(s)},${esc(a)},${esc(to)},${esc(f)}`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `grammar-segment-${label.replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredTraces]);

  const hasValidData = relType === "grammar" || (isMoodIntent ? INTENT_SUPER_LABELS.length > 0 : true);
  const groups = relType !== "grammar" && filteredTraces.length >= 3 && hasValidData && chords ? (chords?.groups ?? []) : [];
  const chordRows = relType !== "grammar" && filteredTraces.length >= 3 && hasValidData && chords ? (chords?.filter((c) => c.source.value > 0) ?? []) : [];

  return (
    <div className="glass-panel p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-teal-mystic">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="5" cy="6" r="2.5" />
              <circle cx="19" cy="6" r="2.5" />
              <circle cx="12" cy="18" r="2.5" />
              <path d="M5 6l7 12" opacity="0.4" />
              <path d="M19 6l-7 12" opacity="0.4" />
            </svg>
            <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
              {cfg.title}
            </span>
          </div>
          <p className="text-[8px] font-mono text-zinc-600 leading-relaxed max-w-[280px]">
            {cfg.description}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
          <select
            value={relType}
            onChange={(e) => setRelType(e.target.value as RelType)}
            className="bg-white/[0.04] border border-white/[0.08] rounded text-[9px] px-2 py-1 text-zinc-400 focus:outline-none focus:border-teal-mystic/30 cursor-pointer"
          >
            <option value="synesthesia">Synesthesia</option>
            <option value="drift">Semantic Drift</option>
            <option value="cross">DDC × LCC</option>
            <option value="intonation">Intonation</option>
            <option value="mood-intent">Mood × Intent</option>
            <option value="grammar">Grammar Schema</option>
          </select>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="bg-white/[0.04] border border-white/[0.08] rounded text-[9px] px-2 py-1 text-zinc-400 focus:outline-none focus:border-teal-mystic/30 cursor-pointer"
          >
            <option value="all">All models</option>
            {availableModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button
            onClick={runAnalysis}
            disabled={analyzing || (relType !== "grammar" && matrix.length === 0) || (relType === "grammar" && filteredTraces.length < 3)}
            className={`transition-colors shrink-0 ${analyzing ? "text-teal-mystic/50" : "text-zinc-500 hover:text-teal-mystic/70"}`}
            title="Analyze with AI"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4l3 3" />
            </svg>
          </button>
          <button
            onClick={() => {
              const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
              const rows: string[] = [];

              if (relType === "synesthesia") {
                rows.push("id,prompt,output,model_used,prompt_type,response_profile");
                for (const t of filteredTraces) {
                  const pc = classifySynesthesiaPrompt(t.prompt);
                  const rc = classifySynesthesiaResponse(t.output || "");
                  rows.push([
                    esc(t.id), esc(t.prompt), esc(t.output || ""), esc(t.model_used || "unknown"),
                    SYN_INPUT_LABELS[pc], SYN_OUTPUT_LABELS[rc],
                  ].join(","));
                }
              } else if (relType === "drift") {
                rows.push("id,prompt,output,model_used,prompt_ddc_code,prompt_ddc_group,response_ddc_code,response_ddc_group");
                for (const t of filteredTraces) {
                  const pc = t.ddc?.prompt?.code || "";
                  const rc = t.ddc?.response?.code || "";
                  rows.push([
                    esc(t.id), esc(t.prompt), esc(t.output || ""), esc(t.model_used || "unknown"),
                    pc, pc ? (DDC_SHORT[parseInt(pc[0])] || "?") : "",
                    rc, rc ? (DDC_SHORT[parseInt(rc[0])] || "?") : "",
                  ].join(","));
                }
              } else if (relType === "cross") {
                rows.push("id,prompt,output,model_used,ddc_code,ddc_group,lcc_code,lcc_group");
                for (const t of filteredTraces) {
                  const dc = t.ddc?.prompt?.code || "";
                  const lc = t.lcc?.prompt?.code || "";
                  const li = lc ? CROSS_LCC_NAMES[lc[0].toUpperCase()] || "?" : "";
                  rows.push([
                    esc(t.id), esc(t.prompt), esc(t.output || ""), esc(t.model_used || "unknown"),
                    dc, dc ? (DDC_SHORT[parseInt(dc[0])] || "?") : "",
                    lc, li,
                  ].join(","));
                }
              } else if (relType === "intonation") {
                rows.push("id,prompt,output,model_used,intonation,output_length,output_bucket");
                const INTON_LABELS = ["Imperative", "Socratic", "Skeptical", "Ambiguous"];
                const BUCKET_LABELS = ["Very Low", "Low", "Medium", "High", "Very High"];
                for (const t of filteredTraces) {
                  const cat = classifyIntonation(t.prompt);
                  const len = (t.output || "").length;
                  const bucket = len < 100 ? 0 : len < 300 ? 1 : len < 700 ? 2 : len < 1500 ? 3 : 4;
                  rows.push([
                    esc(t.id), esc(t.prompt), esc(t.output || ""), esc(t.model_used || "unknown"),
                    INTON_LABELS[cat], String(len), BUCKET_LABELS[bucket],
                  ].join(","));
                }
              } else if (relType === "mood-intent") {
                rows.push("id,prompt,output,model_used,mood,intent_1,intent_2,intent_3");
                for (const t of filteredTraces) {
                  const mood = MOOD5_LABELS[classifyMood5(t.prompt)];
                  const step = t.steps?.find(s => s.label === "Intent Classification");
                  const ips = (step?.metadata?.intent_probs as IntentProb[])?.slice(0, 3).map(ip => ip.label).join("; ") || "";
                  rows.push([
                    esc(t.id), esc(t.prompt), esc(t.output || ""), esc(t.model_used || "unknown"),
                    mood, ips,
                  ].join(","));
                }
              } else if (relType === "grammar") {
                rows.push("id,prompt,output,model_used,depth,mood,syntax,action,tone,form");
                for (const t of filteredTraces) {
                  rows.push([
                    esc(t.id), esc(t.prompt), esc(t.output || ""), esc(t.model_used || "unknown"),
                    DEPTH_LABELS[classifyDepth(t.prompt)],
                    MOOD5_LABELS[classifyMood5(t.prompt)],
                    SYNTAX3_LABELS[classifySyntax(t.prompt)],
                    ACTION_LABELS[classifyActionType(cleanResponse(t.output || ""))],
                    TONE_LABELS[classifyPragmaticTone(cleanResponse(t.output || ""))],
                    FORM_LABELS[classifyOutputForm(cleanResponse(t.output || ""))],
                  ].join(","));
                }
              }

              const blob = new Blob(["\ufeff" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `relationships-${relType}-${selectedModel}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="text-zinc-500 hover:text-teal-mystic/70 transition-colors shrink-0"
            title="Export CSV"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        </div>
      </div>

      {/* Chart */}
      <div ref={containerRef} className="relative rounded-lg overflow-hidden" style={{ background: "linear-gradient(180deg, #041824 0%, #0a2d38 50%, #06303d 100%)" }}>
        {filteredTraces.length < 3 && relType !== "grammar" ? (
          <div className="flex items-center justify-center" style={{ minHeight: "180px" }}>
            <span className="text-[10px] font-mono text-zinc-600">Need at least 3 traces — try a different model or mode</span>
          </div>
        ) : relType === "mood-intent" && isMoodIntent && filteredTraces.length > 0 && !filteredTraces.some(t => t.steps?.some(s => s.label === "Intent Classification" && Array.isArray(s.metadata?.intent_probs))) ? (
          <div className="flex items-center justify-center" style={{ minHeight: "180px" }}>
            <span className="text-[10px] font-mono text-zinc-600">No intent classification data found for these traces</span>
          </div>
        ) : relType === "grammar" && grammarData ? (
          <SynesthSchemaSVG data={grammarData as SynesthNode} onArcClick={handleGrammarExport} />
        ) : (
              <>
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
                  <defs>
                    <radialGradient id="chord-glow" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="rgba(45,212,191,0.05)" />
                      <stop offset="100%" stopColor="rgba(45,212,191,0)" />
                    </radialGradient>
                  </defs>
                  <rect x={0} y={0} width={W} height={H} rx={8} fill="url(#chord-glow)" />

                  <g transform={`translate(${CX}, ${CY})`}>
                    {(groups as any[]).map((g: any, i: number) => {
                      if (g.value === 0) return null;
                      const color = nodeColors[i] || "#374151";
                      const p = arcGen({
                        innerRadius: INNER,
                        outerRadius: RIM,
                        startAngle: safe(g.startAngle),
                        endAngle: safe(g.endAngle),
                      });
                      return (
                        <path key={`group-${i}`} d={p || ""} fill={color} opacity={0.6} stroke="rgba(0,0,0,0.3)" strokeWidth={0.5} />
                      );
                    })}

                    {(groups as any[]).map((g: any, i: number) => {
                      if (g.value === 0) return null;
                      const mid = (g.startAngle + g.endAngle) / 2;
                      const [lx, ly] = polar(0, 0, LABEL_R, mid);
                      const flip = mid > Math.PI / 2 && mid < (3 * Math.PI) / 2;
                      return (
                        <text
                          key={`label-${i}`}
                          x={lx} y={ly}
                          textAnchor={flip ? "end" : "start"}
                          fill="rgba(161,161,170,0.7)"
                          fontSize="7"
                          fontFamily="monospace"
                          transform={flip ? `rotate(${(mid * 180) / Math.PI + 180}, ${lx}, ${ly})` : `rotate(${(mid * 180) / Math.PI}, ${lx}, ${ly})`}
                          style={{ pointerEvents: "none" }}
                        >
                          {allLabels[i]}
                        </text>
                      );
                    })}

                    {chordRows.map((c: Chord, idx: number) => {
                      const src = c.source;
                      const tgt = c.target;
                      const color = nodeColors[src.index] || "#374151";
                      const sr1 = RIM;
                      const tr1 = RIM;
                      const p0 = polar(0, 0, sr1, src.endAngle);
                      const p1 = polar(0, 0, sr1, src.startAngle);
                      const p2 = polar(0, 0, tr1, tgt.startAngle);
                      const p3 = polar(0, 0, tr1, tgt.endAngle);
                      const rCP = RIM * 0.25;
                      const cp0 = polar(0, 0, rCP, src.endAngle);
                      const cp1 = polar(0, 0, rCP, tgt.startAngle);
                      const cp2 = polar(0, 0, rCP, src.startAngle);
                      const cp3 = polar(0, 0, rCP, tgt.endAngle);
                      const d = [
                        `M ${p0[0]},${p0[1]}`,
                        `C ${cp0[0]},${cp0[1]} ${cp1[0]},${cp1[1]} ${p2[0]},${p2[1]}`,
                        `A ${tr1} ${tr1} 0 0 1 ${p3[0]},${p3[1]}`,
                        `C ${cp3[0]},${cp3[1]} ${cp2[0]},${cp2[1]} ${p1[0]},${p1[1]}`,
                        `A ${sr1} ${sr1} 0 0 1 ${p0[0]},${p0[1]}`,
                        `Z`,
                      ].join(" ");
                      return (
                        <path
                          key={`ribbon-${idx}`}
                          d={d}
                          fill={color}
                          opacity={0.25}
                          stroke={color}
                          strokeWidth={0.3}
                          style={{ cursor: "pointer", transition: "opacity 0.15s" }}
                          onMouseEnter={(e) => {
                            const rect = containerRef.current?.getBoundingClientRect();
                            if (rect) {
                              setHoveredChord({
                                source: src.index,
                                target: tgt.index,
                                count: c.source.value,
                                sx: e.clientX - rect.left,
                                sy: e.clientY - rect.top,
                              });
                            }
                          }}
                          onMouseMove={(e) => {
                            const rect = containerRef.current?.getBoundingClientRect();
                            if (rect && hoveredChord) {
                              setHoveredChord({ ...hoveredChord, sx: e.clientX - rect.left, sy: e.clientY - rect.top });
                            }
                          }}
                          onMouseLeave={() => setHoveredChord(null)}
                        />
                      );
                    })}

                    <circle cx={0} cy={0} r={INNER - 4} fill="rgba(6,30,40,0.85)" stroke="rgba(45,212,191,0.08)" strokeWidth={0.5} />
                    <text x={0} y={-3} textAnchor="middle" fill="rgba(45,212,191,0.5)" fontSize="9" fontFamily="monospace">{filteredTraces.length}</text>
                    <text x={0} y={8} textAnchor="middle" fill="rgba(45,212,191,0.25)" fontSize="5" fontFamily="monospace">{selectedModel === "all" ? "traces" : selectedModel!.split(":")[0]}</text>
                  </g>
                </svg>

                {/* Legend */}
                <div className="absolute top-2 left-2 flex flex-col gap-0.5">
                  <span className="text-[7px] font-mono tracking-wider text-zinc-600">
                    {legendSideLeft}
                  </span>
                  {legendInputLabels.map((l, i) => (
                    <div key={`il-${i}`} className="flex items-center gap-1">
                      <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: legendInputColors[i] }} />
                      <span className="text-[6px] font-mono text-zinc-500 truncate max-w-[80px]">{l}</span>
                    </div>
                  ))}
                </div>
                <div className="absolute top-2 right-2 flex flex-col gap-0.5 items-end">
                  <span className="text-[7px] font-mono tracking-wider text-zinc-600">
                    {legendSideRight}
                  </span>
                  {legendOutputLabels.map((l, i) => (
                    <div key={`ol-${i}`} className="flex items-center gap-1">
                      <span className="text-[6px] font-mono text-zinc-500 truncate max-w-[80px]">{l}</span>
                      <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: legendOutputColors[i] }} />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

      {/* Top relationships */}
      {filteredTraces.length >= 3 && topRelationships.length > 0 && (
        <div className="flex flex-col gap-1.5 pt-2 border-t border-white/[0.04]">
          <span className="text-[9px] font-mono tracking-wider text-zinc-600">Strongest Relationships</span>
          <div className="flex flex-col gap-1">
            {topRelationships.map((r, i) => {
              const max = topRelationships[0].count;
              const pct = max > 0 ? (r.count / max) * 100 : 0;
              return (
                <div key={`tr-${i}`} className="flex items-center gap-2">
                  <span className="text-[8px] font-mono text-zinc-500 w-3 text-right">{i + 1}.</span>
                  <span className="text-[8px] font-mono text-zinc-400 truncate flex-1">
                    {allLabels[r.src]} → {allLabels[r.tgt]}
                  </span>
                  <div className="w-14 h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: nodeColors[r.src] }} />
                  </div>
                  <span className="text-[8px] font-mono text-zinc-600 w-5 text-right">{r.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tooltip portal */}
      {filteredTraces.length >= 3 && typeof document !== "undefined" && hoveredChord && createPortal(
        (() => {
          const g = 8;
          const rect = containerRef.current?.getBoundingClientRect();
          if (!rect) return null;
          const sx = rect.left + hoveredChord.sx;
          const sy = rect.top + hoveredChord.sy;
          const tw = 190;
          const onRight = sx > window.innerWidth / 2;
          const left = onRight ? sx - tw - g : sx + g;
          return (
            <div className="fixed z-[100] pointer-events-none" style={{ left, top: sy + g }}>
              <div className="bg-[rgba(6,30,40,0.92)] backdrop-blur-sm border border-teal-mystic/20 rounded-md px-2.5 py-1.5 shadow-lg max-w-[190px]">
                <p className="text-[10px] leading-tight text-teal-mystic/80 font-medium">
                  {allLabels[hoveredChord.source]}
                  <span className="text-zinc-500 mx-1">→</span>
                  {allLabels[hoveredChord.target]}
                </p>
                <p className="text-[9px] text-zinc-400 mt-0.5">{hoveredChord.count} trace{hoveredChord.count !== 1 ? "s" : ""}</p>
              </div>
            </div>
          );
        })(),
        document.body
      )}

      {/* AI Analysis */}
      {analysis !== null && (
        <div className="pt-2 border-t border-white/[0.04] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-mono tracking-wider text-teal-mystic/60">AI Analysis{analysisModel ? ` by ${analysisModel}` : ""}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const blob = new Blob([analysis || ""], { type: "text/plain" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `ai-analysis-${relType}.txt`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="text-[9px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
                title="Save as .txt"
              >
                Save
              </button>
              <button
                onClick={() => setAnalysis(null)}
                className="text-[9px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
          <div className="text-[10px] font-mono text-zinc-400 leading-relaxed whitespace-pre-wrap">
            {analysis}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 6-Ring Synesthesia Schema SVG Component ──────────────
const SW = 420;
const SH = 420;
const SCX = SW / 2;
const SCY = SH / 2;

function collectLevelNodes(root: SynesthNode, depthLevel: number): SynesthNode[] {
  const result: SynesthNode[] = [];
  function walk(n: SynesthNode, d: number) {
    if (d === depthLevel) {
      if (n.startAngle !== undefined && n.endAngle !== undefined && n.endAngle! - n.startAngle! > 0.001) {
        result.push(n);
      }
      return;
    }
    for (const c of n.children || []) walk(c, d + 1);
  }
  for (const c of root.children || []) walk(c, 0);
  return result;
}

function SynesthSchemaSVG({ data, onArcClick }: { data: SynesthNode; onArcClick?: (ring: number, label: string) => void }) {
  const [hovered, setHovered] = useState<{ label: string; count: number; total: number; x: number; y: number; depthRing: number } | null>(null);
  const total = data.count;

  const allArcs: { path: string; color: string; opacity: number; hover: typeof hovered; key: string }[] = [];
  for (let ring = 0; ring < 6; ring++) {
    const spec = RING_SPECS_6[ring];
    const nodes = collectLevelNodes(data, ring);
    for (const node of nodes) {
      const sa = node.startAngle!;
      const ea = node.endAngle!;
      const p = arcGen({ innerRadius: spec.inner, outerRadius: spec.outer, startAngle: sa, endAngle: ea });
      if (!p) continue;
      const opacity = 0.78;
      allArcs.push({
        path: p,
        color: node.color,
        opacity,
        hover: { label: node.label, count: node.count, total, x: 0, y: 0, depthRing: ring },
        key: `r${ring}-${node.label}-${sa.toFixed(4)}`,
      });
    }
  }

  return (
    <svg viewBox={`0 0 ${SW} ${SH}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="syn-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(45,212,191,0.05)" />
          <stop offset="100%" stopColor="rgba(45,212,191,0)" />
        </radialGradient>
      </defs>
      <rect x={0} y={0} width={SW} height={SH} rx={8} fill="url(#syn-glow)" />
      <g transform={`translate(${SCX}, ${SCY})`}>
        {/* Background rings for empty segments */}
        {RING_SPECS_6.map((r, i) => (
          <circle key={`bg-${i}`} cx={0} cy={0} r={r.outer} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={0.3} />
        ))}

        {/* Arcs (painted before center so they sit behind it) */}
        {allArcs.map((a) => (
          <path key={a.key} d={a.path} fill={a.color} opacity={a.opacity} stroke="rgba(0,0,0,0.3)" strokeWidth={0.3}
            style={{ cursor: "pointer", transition: "opacity 0.15s" }}
            onMouseEnter={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setHovered({ ...a.hover!, x: e.clientX, y: e.clientY });
            }}
            onMouseMove={(e) => setHovered(h => h ? { ...h, x: e.clientX, y: e.clientY } : null)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onArcClick?.(a.hover!.depthRing, a.hover!.label)}
          />
        ))}

        {/* Center circle + text on top */}
        <circle cx={0} cy={0} r={14} fill="rgba(6,30,40,0.85)" stroke="rgba(45,212,191,0.08)" strokeWidth={0.5} />
        <text x={0} y={-3} textAnchor="middle" fill="rgba(45,212,191,0.5)" fontSize="9" fontFamily="monospace">{total}</text>
        <text x={0} y={8} textAnchor="middle" fill="rgba(45,212,191,0.2)" fontSize="5" fontFamily="monospace">traces</text>
      </g>

      {/* Legend – ring number + label */}
      <g transform={`translate(8, ${SH - 90})`}>
        <text x={0} y={0} fill="rgba(161,161,170,0.45)" fontSize="5" fontFamily="monospace"># RING</text>
        <line x1={0} y1={4} x2={52} y2={4} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />
        {RING_SPECS_6.map((r, i) => {
          const label = i === 2 ? `${r.label} →` : r.label;
          return (
            <g key={i} transform={`translate(0, ${10 + i * 11})`}>
              <text x={0} y={0} fill="rgba(161,161,170,0.3)" fontSize="5" fontFamily="monospace">{i + 1}</text>
              <text x={10} y={0} fill={i >= 3 ? "rgba(161,161,170,0.5)" : "rgba(161,161,170,0.4)"} fontSize="5" fontFamily="monospace">{label}</text>
            </g>
          );
        })}
      </g>

      {/* Mood color legend */}
      <g transform={`translate(${SW - 88}, ${SH - 95})`}>
        <text x={0} y={0} fill="rgba(161,161,170,0.45)" fontSize="5" fontFamily="monospace">MOOD</text>
        {MOOD5_LABELS.map((l, i) => (
          <g key={i} transform={`translate(0, ${10 + i * 10})`}>
            <rect x={0} y={-3} width={5} height={5} rx={1} fill={MOOD5_COLORS[i]} opacity={0.6} />
            <text x={8} y={1} fill="rgba(161,161,170,0.35)" fontSize="4.5" fontFamily="monospace">{l}</text>
          </g>
        ))}
      </g>

      {/* Hover tooltip */}
      {hovered && typeof document !== "undefined" && createPortal(
        <div className="fixed z-[100] pointer-events-none" style={{ left: Math.min(hovered.x + 12, window.innerWidth - 180), top: hovered.y + 12 }}>
          <div className="bg-[rgba(6,30,40,0.92)] backdrop-blur-sm border border-teal-mystic/20 rounded-md px-2.5 py-1.5 shadow-lg max-w-[170px]">
            <p className="text-[10px] leading-tight text-teal-mystic/80 font-medium">{hovered.label}</p>
            <p className="text-[8px] text-zinc-500 mt-0.5">Ring {hovered.depthRing + 1} · {hovered.count} / {hovered.total} ({total > 0 ? Math.round(hovered.count / total * 100) : 0}%)</p>
          </div>
        </div>,
        document.body
      )}
    </svg>
  );
}
