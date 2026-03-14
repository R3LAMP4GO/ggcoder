import { useEffect } from "react";
import { useStdout } from "ink";
import type { ActivityPhase } from "./useAgentLoop.js";

import { SPINNER_FRAMES, SPINNER_INTERVAL } from "../spinner-frames.js";
import { useAnimationTick, deriveFrame } from "../components/AnimationContext.js";

function getTitleText(phase: ActivityPhase, isRunning: boolean): string {
  if (!isRunning) return "GG Coder";
  switch (phase) {
    case "thinking":
      return "Thinking...";
    case "generating":
      return "Generating...";
    case "tools":
      return "Running tools...";
    case "waiting":
      return "Thinking...";
    default:
      return "GG Coder";
  }
}

export function useTerminalTitle(phase: ActivityPhase, isRunning: boolean): void {
  const { stdout } = useStdout();

  // Derive spinner frame from global animation tick — no independent timer
  const tick = useAnimationTick();
  const spinnerFrame = isRunning ? deriveFrame(tick, SPINNER_INTERVAL, SPINNER_FRAMES.length) : 0;

  // Write terminal title
  useEffect(() => {
    if (!stdout) return;
    const text = getTitleText(phase, isRunning);
    const title = isRunning ? `${SPINNER_FRAMES[spinnerFrame]} ${text}` : text;
    stdout.write(`\x1b]0;${title}\x1b\\`);
  }, [stdout, phase, isRunning, spinnerFrame]);

  // Reset title on unmount
  useEffect(() => {
    return () => {
      stdout?.write(`\x1b]0;GG Coder\x1b\\`);
    };
  }, [stdout]);
}
