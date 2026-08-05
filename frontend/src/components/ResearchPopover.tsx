"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getResearchRefs, type ResearchKey } from "@/data/researchRefs";

interface Props {
  refKey: ResearchKey;
  align?: "left" | "right";
  className?: string;
}

export default function ResearchPopover({ refKey, align = "left", className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const refs = getResearchRefs(refKey);

  if (refs.length === 0) return null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (e: React.MouseEvent) => {
    setPos({ x: e.clientX, y: e.clientY });
    setOpen((o) => !o);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-label={`Research basis: ${refs[0].title}`}
        title="Research basis"
        className={`text-[10px] leading-none text-zinc-600/50 hover:text-teal-mystic/80 transition-colors cursor-help select-none ${className}`}
      >
        ⓘ
      </button>
      {open && typeof document !== "undefined" && (
        createPortal(
          <div
            ref={popRef}
            className="fixed z-[100] glass-panel p-3 space-y-2.5"
            style={{
              left: align === "left" ? Math.min(pos.x + 12, window.innerWidth - 300) : Math.max(pos.x - 280, 8),
              top: Math.min(pos.y + 14, window.innerHeight - 220),
              width: 280,
            }}
          >
            <div className="text-[8px] font-mono tracking-[0.2em] uppercase text-zinc-500">
              Research basis
            </div>
            {refs.map((r, i) => (
              <div key={i} className="space-y-1">
                <div className="text-[9px] font-mono text-zinc-300 leading-relaxed">
                  {r.authors} ({r.year}). <em>{r.title}</em>. {r.venue}.
                </div>
                <div className="text-[8.5px] font-mono text-zinc-500 leading-relaxed">
                  {r.relevance}
                </div>
                {r.url && (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[8.5px] font-mono text-teal-mystic/70 hover:text-teal-mystic underline underline-offset-2"
                  >
                    ↗ {r.url.replace(/^https?:\/\//, "")}
                  </a>
                )}
              </div>
            ))}
          </div>,
          document.body
        )
      )}
    </>
  );
}
