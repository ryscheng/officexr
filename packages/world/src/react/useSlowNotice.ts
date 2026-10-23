import { useEffect, useState } from 'react';

export const SLOW_LOAD_MS = 60_000;

/** True once `loading` has held for {@link SLOW_LOAD_MS}, until it stops. */
export function useSlowNotice(loading: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) {
      return;
    }
    const timer = setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => clearTimeout(timer);
  }, [loading]);
  return loading && slow;
}
