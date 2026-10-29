import { useEffect, useState } from 'react';

const performanceNow = () => performance.now();

/** `clock()`, re-read every `intervalMs`. Defaults to `performance.now`, the SyncEngine clock; `clock` must be stable. */
export function useNow(intervalMs: number, clock: () => number = performanceNow): number {
  const [now, setNow] = useState(clock);
  useEffect(() => {
    const id = setInterval(() => setNow(clock()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, clock]);
  return now;
}
