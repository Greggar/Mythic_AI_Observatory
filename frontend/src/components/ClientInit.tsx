"use client";

import { useEffect } from "react";

export default function ClientInit() {
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      console.error("[Unhandled rejection]", event.reason);
    };
    const onError = (event: ErrorEvent) => {
      if (event.message?.includes("ResizeObserver") || event.message?.includes("Script error")) return;
      console.error("[Uncaught error]", event.message, event.filename, event.lineno);
    };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  return null;
}
