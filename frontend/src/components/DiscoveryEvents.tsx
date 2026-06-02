"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

interface Props {
  traceConfidence: number | null;
  insightTags: string[];
  traceId: string | null;
  triggerEvent: number;
}

type DiscoveryType = "high_confidence" | "novel_insight" | "first_connection" | "unusual_pattern" | null;

const DISCOVERY_CONFIG: Record<string, { label: string; color: string; glowColor: string; rings: number }> = {
  high_confidence: {
    label: "High-Confidence Completion",
    color: "#fbbf24",
    glowColor: "rgba(251,191,36,0.3)",
    rings: 3,
  },
  novel_insight: {
    label: "Novel Insight Detected",
    color: "#2dd4bf",
    glowColor: "rgba(45,212,191,0.3)",
    rings: 4,
  },
  first_connection: {
    label: "New Remote Connected",
    color: "#34d399",
    glowColor: "rgba(52,211,153,0.3)",
    rings: 2,
  },
  unusual_pattern: {
    label: "Unusual Pattern",
    color: "#f59e0b",
    glowColor: "rgba(245,158,11,0.3)",
    rings: 5,
  },
};

export default function DiscoveryEvents({
  traceConfidence,
  insightTags,
  traceId,
  triggerEvent,
}: Props) {
  const [discovery, setDiscovery] = useState<DiscoveryType>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Detect discovery events based on trace data
  useEffect(() => {
    if (!traceId || triggerEvent === 0) return;

    const checkDiscovery = async () => {
      // High confidence
      if (traceConfidence !== null && traceConfidence > 0.85) {
        setDiscovery("high_confidence");
        setTimeout(() => setDiscovery(null), 4000);
        return;
      }

      // Novel insight tags
      if (insightTags.includes("high_confidence") || insightTags.includes("rich_response")) {
        setDiscovery("novel_insight");
        setTimeout(() => setDiscovery(null), 4000);
        return;
      }

      // Unusual: first trace of a session or perfect pipeline
      if (insightTags.includes("perfect_pipeline")) {
        setDiscovery("unusual_pattern");
        setTimeout(() => setDiscovery(null), 4000);
        return;
      }
    };

    checkDiscovery();
  }, [traceConfidence, insightTags, traceId, triggerEvent]);

  if (!discovery) return null;

  const config = DISCOVERY_CONFIG[discovery];
  if (!config) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-50 flex items-center justify-center">
      {/* Background constellation (static) */}
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice">
        <g opacity="0.04" fill="none" stroke={config.color} strokeWidth="0.2">
          <circle cx="140" cy="120" r="2" />
          <circle cx="260" cy="100" r="1.5" />
          <circle cx="300" cy="180" r="1.8" />
          <circle cx="120" cy="190" r="1.3" />
          <line x1="140" y1="120" x2="260" y2="100" />
          <line x1="260" y1="100" x2="300" y2="180" />
          <line x1="300" y1="180" x2="120" y2="190" />
          <line x1="120" y1="190" x2="140" y2="120" />
        </g>
        {/* Comet emergence — streaking into view */}
        <g>
          <motion.path
            d="M 360 60 C 320 70, 280 90, 240 120 C 210 140, 200 150, 200 150"
            fill="none" stroke={config.color} strokeWidth="1.5"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: [0, 0.8, 0.8, 0], opacity: [0, 0.5, 0.5, 0] }}
            transition={{ duration: 5, delay: 2, ease: "easeOut" }}
          />
          <motion.path
            d="M 370 65 C 330 80, 280 100, 245 125 C 220 140, 205 150, 205 150"
            fill="none" stroke="#2dd4bf" strokeWidth="0.8"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: [0, 0.6, 0.6, 0], opacity: [0, 0.25, 0.25, 0] }}
            transition={{ duration: 5, delay: 2, ease: "easeOut" }}
          />
          {/* Discovery nucleus */}
          <motion.circle
            cx={200} cy={150} r={0}
            fill={config.color}
            initial={{ r: 0, opacity: 0 }}
            animate={{ r: [0, 0, 4, 6, 2, 0], opacity: [0, 0, 1, 0.8, 0.4, 0] }}
            transition={{ duration: 5, delay: 2, ease: "easeOut" }}
          />
          {/* Expanding glow ring */}
          <motion.circle
            cx={200} cy={150} r={0}
            fill="none" stroke={config.color} strokeWidth="0.5"
            initial={{ r: 0, opacity: 0 }}
            animate={{ r: [0, 0, 10, 25, 40, 60], opacity: [0, 0, 0.4, 0.2, 0.1, 0] }}
            transition={{ duration: 5, delay: 2, ease: "easeOut" }}
          />
        </g>
        {/* Ripple rings across knowledge field */}
        <g opacity="0.06">
          <motion.circle
            cx={200} cy={150} r={0}
            fill="none" stroke="#2dd4bf" strokeWidth="0.3"
            initial={{ r: 0, opacity: 0 }}
            animate={{ r: [0, 15, 40, 70, 100, 130], opacity: [0, 0.2, 0.15, 0.1, 0.05, 0] }}
            transition={{ duration: 5, delay: 2, ease: "easeOut" }}
          />
          <motion.circle
            cx={200} cy={150} r={0}
            fill="none" stroke="#2dd4bf" strokeWidth="0.2"
            initial={{ r: 0, opacity: 0 }}
            animate={{ r: [0, 10, 30, 55, 85, 110], opacity: [0, 0.15, 0.1, 0.06, 0.03, 0] }}
            transition={{ duration: 5, delay: 2.3, ease: "easeOut" }}
          />
        </g>
      </svg>

      {/* Label */}
      <motion.div
        className="relative"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.2, 1], opacity: [0, 1, 1] }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      >
        <motion.div
          className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: [0, 1, 0], y: [8, 0, -4] }}
          transition={{ duration: 3, delay: 0.3, ease: "easeInOut" }}
        >
          <span
            className="text-[10px] font-mono tracking-widest uppercase px-3 py-1 rounded-full"
            style={{
              color: config.color,
              background: config.glowColor,
              border: `1px solid ${config.color}40`,
            }}
          >
            {config.label}
          </span>
        </motion.div>
      </motion.div>
    </div>
  );
}
