import { useState, useEffect, useRef, useCallback } from 'react';

interface UseVirtualScrollOptions {
  itemHeight: number;
  overscan?: number;
  containerHeight: number;
  totalItems: number;
}

export function useVirtualScroll<T>(items: T[], options: UseVirtualScrollOptions) {
  const { itemHeight, overscan = 5, containerHeight, totalItems } = options;
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: Math.ceil(containerHeight / itemHeight) + overscan });
  const containerRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const scrollTop = containerRef.current.scrollTop;
    const start = Math.floor(scrollTop / itemHeight);
    const end = start + Math.ceil(containerHeight / itemHeight) + overscan * 2;
    setVisibleRange({
      start: Math.max(0, start - overscan),
      end: Math.min(totalItems, end),
    });
  }, [itemHeight, overscan, containerHeight, totalItems]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const visibleItems = items.slice(visibleRange.start, visibleRange.end);
  const totalHeight = totalItems * itemHeight;
  const offsetY = visibleRange.start * itemHeight;

  return { containerRef, visibleItems, totalHeight, offsetY };
}
