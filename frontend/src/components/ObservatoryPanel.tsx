"use client";

import { motion } from "framer-motion";
import { Telescope } from "lucide-react";

interface Props {
  children: React.ReactNode;
  active: boolean;
}

export default function ObservatoryPanel({ children, active }: Props) {
  return (
    <motion.div
      className="relative"
      initial={false}
      animate={active ? { opacity: 1 } : { opacity: 0.6 }}
    >
      {!active && (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-600 gap-3">
          <Telescope size={32} className="text-zinc-700" />
          <span className="text-xs font-mono tracking-wider">
            Submit a prompt to begin
          </span>
        </div>
      )}

      <motion.div
        animate={active ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
        transition={{ duration: 0.5, ease: "easeInOut" }}
        className="overflow-hidden"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
