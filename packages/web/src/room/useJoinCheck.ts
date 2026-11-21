import { useEffect, useState } from 'react';
import { apiFetch, paths } from '../apiOrigin';
import { fetchRealtimeToken } from './realtimeToken';

export type JoinCheck = 'checking' | 'prompt' | 'go';

export type JoinCheckControl = { state: JoinCheck; join: () => void };

// ponytail: a very fast reload may briefly see its own old session as connected and prompt.
// ponytail: a tab that was reconnecting when another window joined replaces that window on reconnect, without prompting.
/** Asks whether `login` is already in the office and, if joining would replace that session, waits for a decision. */
export function useJoinCheck(officeId: string, login: string, fetchFn: typeof apiFetch = apiFetch): JoinCheckControl {
  const [state, setState] = useState<JoinCheck>('checking');
  useEffect(() => {
    let cancelled = false;
    setState('checking');
    fetchRealtimeToken(fetchFn)
      .then((token) => fetchFn(paths.sessions(officeId, login, token)))
      .then((res) => (res.ok ? (res.json() as Promise<{ connected: boolean; allowMulti: boolean }>) : null))
      // The server enforces the rule either way, so an unanswered check just joins.
      .catch(() => null)
      .then((found) => {
        if (!cancelled) {
          setState(found?.connected && !found.allowMulti ? 'prompt' : 'go');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [officeId, login, fetchFn]);
  return {
    state,
    join: () => setState('go'),
  };
}
