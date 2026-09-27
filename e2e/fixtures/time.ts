export const SECONDS_PER_HOUR = 3600;

export function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Unix seconds at `hours` in the future. */
export function deadlineInHours(hours: number): number {
  return nowInSeconds() + Math.round(hours * SECONDS_PER_HOUR);
}
