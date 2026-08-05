export interface ResearchRef {
  authors: string;
  year: string;
  title: string;
  venue: string;
  url: string;
  relevance: string;
}

export type ResearchKey =
  | "token-entropy"
  | "calibration"
  | "memory-retrieval"
  | "entropy-def"
  | "ddc"
  | "lcc"
  | "conversation"
  | "reasoning-fragility";

export const RESEARCH_REFS: Record<ResearchKey, ResearchRef[]> = {
  "token-entropy": [
    {
      authors: "Kadavath, Lang, Conerly, Kahle, Henighan, Brown, Kupers, Kaplan, McCandlish, Amodei",
      year: "2022",
      title: "Language Models (Mostly) Know What They Know",
      venue: "arXiv:2207.05221",
      url: "https://arxiv.org/abs/2207.05221",
      relevance:
        "Token-level entropy and conditional log-probabilities directly reflect whether a model knows a fact or is guessing — the foundation of the uncertainty workstream.",
    },
  ],
  calibration: [
    {
      authors: "Guo, Pleiss, Sun, Weinberger",
      year: "2017",
      title: "On Calibration of Modern Neural Networks",
      venue: "ICML",
      url: "http://proceedings.mlr.press/v70/guo17a.html",
      relevance:
        "Classifier confidence is not accuracy; calibration must be measured, never assumed — why DDC/LCC margin and intent confidence are reported alongside entropy.",
    },
    {
      authors: "Kadavath et al.",
      year: "2022",
      title: "Language Models (Mostly) Know What They Know",
      venue: "arXiv:2207.05221",
      url: "https://arxiv.org/abs/2207.05221",
      relevance:
        "Calibration from the model's own output distribution (log-probs) rather than a separate classifier — the entropy-aware reading of confidence.",
    },
  ],
  "memory-retrieval": [
    {
      authors: "Lewis, Perez, Piktus, Petroni, Karpukhin, Goyal, Küttler, Lewis, Yih, Rocktäschel, Riedel, Kiela",
      year: "2020",
      title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
      venue: "NeurIPS",
      url: "https://arxiv.org/abs/2005.11401",
      relevance:
        "Grounding generation in retrieved context — the architectural basis for the memory stage and the used-vs-discarded grounding lens.",
    },
  ],
  "entropy-def": [
    {
      authors: "Shannon",
      year: "1948",
      title: "A Mathematical Theory of Communication",
      venue: "Bell System Technical Journal",
      url: "https://doi.org/10.1002/j.1538-7305.1948.tb01338.x",
      relevance:
        "The definition of the quantity every uncertainty panel reports: −Σ p·log2(p) in bits.",
    },
  ],
  ddc: [
    {
      authors: "Dewey",
      year: "1876",
      title: "Dewey Decimal Classification",
      venue: "OCLC",
      url: "https://www.oclc.org/en/dewey.html",
      relevance:
        "The ontology the DDC classifier maps prompts and responses onto — a library taxonomy repurposed as a semantic fingerprint.",
    },
  ],
  lcc: [
    {
      authors: "Library of Congress",
      year: "1897",
      title: "Library of Congress Classification",
      venue: "Library of Congress",
      url: "https://www.loc.gov/catdir/cpso/lcc.html",
      relevance:
        "The second ontology used for prompt/response fingerprinting; its letter system becomes the sunburst's outer rings.",
    },
  ],
  conversation: [
    {
      authors: "Tomasello",
      year: "2014",
      title: "A Natural History of Human Thinking",
      venue: "Harvard University Press",
      url: "https://www.hup.harvard.edu/books/9780674724778",
      relevance:
        "Frames conversation as a cooperative, phase-structured phenomenon — the lens behind chat-phase and conversation-topology analysis.",
    },
  ],
  "reasoning-fragility": [
    {
      authors: "Mirzadeh, Alizadeh, Shahrokhi, Tuzel, Bengio, Farajtabar",
      year: "2024",
      title: "GSM-Symbolic: Understanding the Limitations of Mathematical Reasoning in Large Language Models",
      venue: "ICLR 2025",
      url: "https://arxiv.org/abs/2410.05229",
      relevance:
        "Shows LLM 'reasoning' is partly pattern-matching, not formal deduction: accuracy drops when numeric values alone are re-randomized, and adding a single seemingly-relevant but irrelevant clause collapses accuracy up to 65% — the benchmark analogue of our used-vs-discarded retrieval grounding lens.",
    },
    {
      authors: "Shojaee, Mirzadeh, Alizadeh, Horton, Bengio, Farajtabar",
      year: "2025",
      title: "The Illusion of Thinking: Understanding the Strengths and Limitations of Reasoning Models via the Lens of Problem Complexity",
      venue: "NeurIPS 2025",
      url: "https://arxiv.org/abs/2506.06941",
      relevance:
        "The companion finding to GSM-Symbolic: reasoning effort (inference-time thinking tokens) rises with problem complexity then declines near the collapse point, despite spare budget — an 'effort gives up' signature plus an overthinking regime (correct answer found early, then wasted exploration) that map directly onto our token-count, entropy-series, and trace-shape telemetry.",
    },
  ],
};

export function getResearchRefs(key: ResearchKey): ResearchRef[] {
  return RESEARCH_REFS[key] ?? [];
}
