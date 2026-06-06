"use client";
import { createContext, useContext, useState, ReactNode } from "react";

interface HoverContextType {
  hoveredTraceId: string | null;
  setHoveredTraceId: (id: string | null) => void;
}

const HoverContext = createContext<HoverContextType>({
  hoveredTraceId: null,
  setHoveredTraceId: () => {},
});

export function HoverProvider({ children }: { children: ReactNode }) {
  const [hoveredTraceId, setHoveredTraceId] = useState<string | null>(null);
  return (
    <HoverContext.Provider value={{ hoveredTraceId, setHoveredTraceId }}>
      {children}
    </HoverContext.Provider>
  );
}

export function useHover() {
  return useContext(HoverContext);
}
