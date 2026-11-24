import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia(query);
    if (!media) {
      return;
    }
    setMatches(Boolean(media.matches));

    const listener = (event: MediaQueryListEvent) => {
      setMatches(Boolean(event.matches));
    };

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', listener);
      return () => media.removeEventListener('change', listener);
    } else if (typeof (media as any).addListener === 'function') {
      (media as any).addListener(listener);
      return () => (media as any).removeListener(listener);
    }
  }, [query]);

  return matches;
}
