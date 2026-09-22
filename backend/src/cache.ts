const cache = new Map<string, { data: any; timestamp: number }>();
const TTL_MS = 5 * 60 * 1000;
export function getCached(key: string): any | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TTL_MS) { cache.delete(key); return null; }
  return entry.data;
}
export function setCache(key: string, data: any): void {
  cache.set(key, { data, timestamp: Date.now() });
}
export function clearCache(): void { cache.clear(); }
