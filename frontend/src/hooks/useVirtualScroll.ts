import { useState, useEffect, useCallback } from "react";
export function useVirtualScroll(itemCount: number, itemHeight = 80, containerHeight = 600) {
  const [scrollTop, setScrollTop] = useState(0);
  const visibleCount = Math.ceil(containerHeight / itemHeight) + 1;
  const startIdx = Math.max(0, Math.floor(scrollTop / itemHeight) - 1);
  const onScroll = useCallback((e: any) => { setScrollTop(e.target.scrollTop); }, []);
  return { startIdx, visibleCount, onScroll, totalHeight: itemCount * itemHeight };
}
