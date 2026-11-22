import { useEffect, useState } from 'react';
import { useStableCallback } from '../useStableCallback';

const CLOCK_MS = 60_000;

/** The time at the resolution missions show it (minutes), so rows re-render once a minute, not with their panel. */
export function useClock(now: () => Date): Date {
  const read = useStableCallback(now);
  const [clock, setClock] = useState(read);
  useEffect(() => {
    const id = setInterval(() => setClock(read()), CLOCK_MS);
    return () => clearInterval(id);
  }, [read]);
  return clock;
}
