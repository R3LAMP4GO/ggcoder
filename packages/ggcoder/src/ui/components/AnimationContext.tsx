import React, { createContext, useContext, useState, useEffect } from "react";

/**
 * Global animation tick context.
 *
 * Provides a single `tick` counter (incremented every TICK_INTERVAL ms)
 * that all animated components derive their frames from via modular
 * arithmetic.  This replaces per-component setIntervals that each caused
 * independent React re-renders — N spinners no longer means N timers.
 *
 * The tick only runs while at least one AnimationProvider is mounted
 * (i.e. while the app is alive).
 */

const TICK_INTERVAL = 100; // ms — fast enough for the spinner (120ms frames)

const AnimationContext = createContext(0);

export function AnimationProvider({ children }: { children: React.ReactNode }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, TICK_INTERVAL);
    return () => clearInterval(timer);
  }, []);

  return <AnimationContext value={tick}>{children}</AnimationContext>;
}

/** Returns the current global animation tick counter. */
export function useAnimationTick(): number {
  return useContext(AnimationContext);
}

/** Derive a frame index from the global tick for a given interval and frame count. */
export function deriveFrame(tick: number, intervalMs: number, frameCount: number): number {
  return Math.floor((tick * TICK_INTERVAL) / intervalMs) % frameCount;
}

export { TICK_INTERVAL };
