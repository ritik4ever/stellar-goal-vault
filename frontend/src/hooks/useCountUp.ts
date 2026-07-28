import { useEffect, useState } from 'react';

function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

/**
 * Animates a numeric value toward `target` when `animate` is true; otherwise snaps immediately.
 */
export function useCountUp(target: number, animate: boolean, durationMs = 1200): number {
  const [display, setDisplay] = useState(animate ? 0 : target);

  useEffect(() => {
    if (!animate) {
      setDisplay(target);
      return undefined;
    }

    let startTime: number | null = null;
    let frameId = 0;

    const step = (timestamp: number) => {
      if (startTime === null) {
        startTime = timestamp;
      }
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      setDisplay(target * easeOutCubic(progress));
      if (progress < 1) {
        frameId = requestAnimationFrame(step);
      } else {
        setDisplay(target);
      }
    };

    frameId = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [target, animate, durationMs]);

  return display;
}
