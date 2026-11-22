import { useEffect, useState } from 'react';
import { apiFetch, paths } from './apiOrigin';

export function useOfficeName(roomId: string | null): string | null {
  const [found, setFound] = useState<{ roomId: string; name: string } | null>(null);
  useEffect(() => {
    if (roomId === null) {
      return;
    }
    let cancelled = false;
    apiFetch(paths.officeName(roomId))
      .then(async (res) => (res.ok ? ((await res.json()) as { name?: unknown }).name : undefined))
      .then((name) => {
        if (!cancelled && typeof name === 'string' && name.trim() !== '') {
          setFound({ roomId, name });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [roomId]);
  return found !== null && found.roomId === roomId ? found.name : null;
}
