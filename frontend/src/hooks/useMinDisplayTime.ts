import { useState, useEffect, useRef } from 'react';

export function useMinDisplayTime(isLoading: boolean, minTimeMs: number = 200): boolean {
  const [show, setShow] = useState(isLoading);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (isLoading) {
      startRef.current = Date.now();
      setShow(true);
    } else if (startRef.current !== null) {
      const elapsed = Date.now() - startRef.current;
      if (elapsed >= minTimeMs) {
        setShow(false);
      } else {
        const timer = setTimeout(() => setShow(false), minTimeMs - elapsed);
        return () => clearTimeout(timer);
      }
    }
  }, [isLoading, minTimeMs]);

  return show;
}
