"use client";

import { useEffect, useRef, useState } from "react";

/** House easing (cubic-bezier(0.2, 0, 0, 1)) approximated for JS interpolation. */
function easeHouse(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Animate a number toward `target` whenever it changes (StatTile count-up).
 * Respects prefers-reduced-motion by snapping instantly.
 */
export function useCountUp(target: number, durationMs = 600): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || durationMs <= 0) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const v = from + (target - from) * easeHouse(t);
      setValue(t >= 1 ? target : v);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, durationMs]);

  return value;
}
