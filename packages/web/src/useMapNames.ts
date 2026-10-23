import { useEffect, useState } from 'react';
import { FilesystemMapStorage } from '@officexr/world/scenes';

/** The studio map names available to offices, or why they couldn't be listed. */
export function useMapNames(): { maps: string[]; error: string | null } {
  const [state, setState] = useState<{ maps: string[]; error: string | null }>({ maps: [], error: null });
  useEffect(() => {
    let cancelled = false;
    new FilesystemMapStorage()
      .list()
      .then((list) => {
        if (!cancelled) {
          setState({ maps: list.map((m) => m.name), error: null });
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setState({ maps: [], error: err.message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
