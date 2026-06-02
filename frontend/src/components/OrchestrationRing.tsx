"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

interface RingConfig {
  radius: number;
  strokeWidth: number;
  speed: number; // seconds per full rotation (positive = CW, negative = CCW)
  dashArray?: string;
  opacity?: number;
  color?: string;
}

interface Props {
  size: number;
  rings: RingConfig[];
  observatoryMode?: boolean;
}

export default function OrchestrationRing({ size, rings, observatoryMode = false }: Props) {
  const CX = size / 2;
  const CY = size / 2;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <g>
      {rings.map((ring, i) => (
        <motion.g
          key={`ring-${i}`}
          style={{ originX: CX, originY: CY }}
          animate={
            mounted
              ? ring.speed > 0
                ? { rotate: 360 }
                : { rotate: -360 }
              : { rotate: 0 }
          }
          transition={{
            duration: Math.abs(ring.speed) * (observatoryMode ? 0.6 : 1),
            repeat: Infinity,
            ease: "linear",
          }}
        >
          <circle
            cx={CX}
            cy={CY}
            r={ring.radius}
            fill="none"
            stroke={ring.color || "rgba(45,212,191,0.06)"}
            strokeWidth={ring.strokeWidth}
            strokeDasharray={ring.dashArray}
            opacity={ring.opacity ?? 1}
          />
        </motion.g>
      ))}

      {/* knotwork outer ring — interlocking arcs */}
      {rings.length > 0 && (
        <motion.g
          style={{ originX: CX, originY: CY }}
          animate={mounted ? { rotate: 360 } : { rotate: 0 }}
          transition={{
            duration: Math.abs(rings[rings.length - 1].speed) * 1.3,
            repeat: Infinity,
            ease: "linear",
          }}
        >
          {[0, 72, 144, 216, 288].map((angle, i) => {
            const outerR = rings[rings.length - 1].radius;
            const rad = (angle * Math.PI) / 180;
            const knotR = outerR * 0.97;
            const x1 = CX + knotR * Math.cos(rad);
            const y1 = CY + knotR * Math.sin(rad);
            const nextAngle = ((angle + 36) * Math.PI) / 180;
            const nextR = outerR * 1.03;
            const x2 = CX + nextR * Math.cos(nextAngle);
            const y2 = CY + nextR * Math.sin(nextAngle);
            return (
              <path
                key={`knot-${i}`}
                d={`M ${x1.toFixed(4)} ${y1.toFixed(4)} Q ${(CX + outerR * 1.15 * Math.cos(rad + Math.PI / 10)).toFixed(4)} ${(CY + outerR * 1.15 * Math.sin(rad + Math.PI / 10)).toFixed(4)} ${x2.toFixed(4)} ${y2.toFixed(4)}`}
                fill="none"
                stroke="rgba(45,212,191,0.05)"
                strokeWidth="1.5"
              />
            );
          })}
        </motion.g>
      )}
    </g>
  );
}
