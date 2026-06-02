"use client";

import { useMemo, useState } from "react";

interface Props {
  size: number;
  cx: number;
  cy: number;
  observatoryMode?: boolean;
}

function celticKnot(x: number, y: number, r: number, lobes: number, offset: number) {
  const pts: [number, number][] = [];
  for (let i = 0; i < lobes * 2; i++) {
    const angle = (i / (lobes * 2)) * Math.PI * 2 + offset;
    const modR = r * (i % 2 === 0 ? 1 : 0.6);
    pts.push([
      x + modR * Math.cos(angle),
      y + modR * Math.sin(angle),
    ]);
  }
  let d = "";
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const c = pts[(i + 2) % pts.length];
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    if (i === 0) d += `M ${mx.toFixed(2)} ${my.toFixed(2)}`;
    d += ` Q ${b[0].toFixed(2)} ${b[1].toFixed(2)} ${((mx + c[0]) / 2).toFixed(2)} ${((my + c[1]) / 2).toFixed(2)}`;
  }
  d += " Z";
  return d;
}

function astrolabeRing(cx: number, cy: number, r: number) {
  const arcs: string[] = [];
  for (let i = 0; i < 36; i++) {
    const a1 = (i * 10 * Math.PI) / 180;
    const a2 = ((i * 10 + 4) * Math.PI) / 180;
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2);
    const y2 = cy + r * Math.sin(a2);
    arcs.push(`M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`);
  }
  return arcs.join(" ");
}

function maritimeCompassRose(cx: number, cy: number, r: number) {
  const lines: string[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = (i * 45 * Math.PI) / 180;
    const outerR = r * (i % 2 === 0 ? 1 : 0.7);
    lines.push(`M ${cx.toFixed(2)} ${cy.toFixed(2)} L ${(cx + outerR * Math.cos(angle)).toFixed(2)} ${(cy + outerR * Math.sin(angle)).toFixed(2)}`);
  }
  return lines.join(" ");
}

export default function SacredGeometry({ size, cx, cy, observatoryMode = false }: Props) {
  const geoOpacity = observatoryMode ? 0.06 : 0.035;
  const knot1 = useMemo(() => celticKnot(cx, cy, 140, 8, 0), [cx, cy]);
  const knot2 = useMemo(() => celticKnot(cx, cy, 190, 12, Math.PI / 12), [cx, cy]);
  const astrolabe1 = useMemo(() => astrolabeRing(cx, cy, 240), [cx, cy]);
  const compassRose = useMemo(() => maritimeCompassRose(cx, cy, 120), [cx, cy]);

  return (
    <g style={{ pointerEvents: "none" }}>
      <defs>
        <radialGradient id="geoGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.04" />
          <stop offset="70%" stopColor="#2dd4bf" stopOpacity="0.02" />
          <stop offset="100%" stopColor="transparent" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx={cx} cy={cy} r={250} fill="url(#geoGlow)" />

      {/* Outer astrolabe ring */}
      <g>
        <path d={astrolabe1} fill="none" stroke="rgba(45,212,191,0.04)" strokeWidth="0.5" />
        <animateTransform attributeName="transform" type="rotate" from={`0 ${cx} ${cy}`} to={`360 ${cx} ${cy}`} dur="180s" repeatCount="indefinite" />
      </g>

      {/* Celtic knot 1 — counter-rotating, weave drawing */}
      <g>
        <path d={knot1} fill="none" stroke="rgba(45,212,191,0.035)" strokeWidth="0.6" strokeDasharray="400">
          <animate attributeName="stroke-dashoffset" from="400" to="0" dur="14s" repeatCount="indefinite" />
        </path>
        <animateTransform attributeName="transform" type="rotate" from={`0 ${cx} ${cy}`} to={`-360 ${cx} ${cy}`} dur="240s" repeatCount="indefinite" />
      </g>

      {/* Celtic knot 2 — slower, opposite, weave drawing */}
      <g>
        <path d={knot2} fill="none" stroke="rgba(45,212,191,0.025)" strokeWidth="0.5" strokeDasharray="600">
          <animate attributeName="stroke-dashoffset" from="600" to="0" dur="18s" repeatCount="indefinite" begin="1s" />
        </path>
        <animateTransform attributeName="transform" type="rotate" from={`0 ${cx} ${cy}`} to={`360 ${cx} ${cy}`} dur="300s" repeatCount="indefinite" />
      </g>

      {/* Maritime compass rose */}
      <g>
        <path d={compassRose} fill="none" stroke="rgba(45,212,191,0.03)" strokeWidth="0.4" />
        <animateTransform attributeName="transform" type="rotate" from={`0 ${cx} ${cy}`} to={`360 ${cx} ${cy}`} dur="400s" repeatCount="indefinite" />
      </g>

      {/* Illuminated manuscript marginal dots */}
      {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((angle) => {
        const rad = (angle * Math.PI) / 180;
        const r = 220;
        return (
          <circle
            key={`dot-${angle}`}
            cx={cx + r * Math.cos(rad)}
            cy={cy + r * Math.sin(rad)}
            r={1}
            fill="rgba(45,212,191,0.04)"
          />
        );
      })}
    </g>
  );
}
