import React from "react";
import { Text } from "ink";
import { useTheme } from "../theme/theme.js";
import { SPINNER_FRAMES, SPINNER_INTERVAL } from "../spinner-frames.js";
import { useAnimationTick, deriveFrame } from "./AnimationContext.js";

export function Spinner({ label }: { label?: string }) {
  const theme = useTheme();
  const tick = useAnimationTick();
  const frame = deriveFrame(tick, SPINNER_INTERVAL, SPINNER_FRAMES.length);

  return (
    <Text color={theme.spinnerColor}>
      {SPINNER_FRAMES[frame]} {label && <Text dimColor>{label}</Text>}
    </Text>
  );
}
