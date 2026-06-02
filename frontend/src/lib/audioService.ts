/**
 * Audio Service — Event-driven framework for future atmospheric audio.
 *
 * No actual sound assets are loaded. This service provides typed event hooks
 * that can be wired to audio playback when assets become available.
 *
 * Events:
 *   orchestration-start   — prompt submitted, pipeline begins
 *   stage-complete        — individual pipeline step finished
 *   orchestration-complete — all steps resolved
 *   error                 — pipeline or remote error
 *   idle                  — system returns to idle
 *   pulse                 — periodic heartbeat pulse
 */

export type AudioEvent =
  | "orchestration-start"
  | "stage-complete"
  | "orchestration-complete"
  | "error"
  | "idle"
  | "pulse";

type AudioHandler = (event: AudioEvent, data?: unknown) => void;

const listeners = new Set<AudioHandler>();

export function onAudioEvent(handler: AudioHandler): () => void {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

export function emitAudioEvent(event: AudioEvent, data?: unknown): void {
  for (const handler of listeners) {
    try {
      handler(event, data);
    } catch {
      // prevent one bad handler from crashing others
    }
  }
}

export function createAudioPlayer() {
  return {
    play: (_event: AudioEvent) => {
      // Placeholder: wire to Howler.js or Web Audio API when assets are ready
      console.debug("[audio] event:", _event);
    },
    dispose: () => {
      listeners.clear();
    },
  };
}
