import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export type JoinCheck = 'checking' | 'prompt' | 'go' | 'cancelled';

/** Asks whether `login` is already in the office and, if joining would replace that session, waits for a decision. */
// ponytail: a very fast reload may see its own old session as connected and prompt; a tab that was reconnecting when another window joined replaces it on reconnect without prompting.
export function useJoinCheck(officeId: string, login: string, fetchFn: typeof fetch = fetch) {
  const [state, setState] = useState<JoinCheck>('checking');
  const navigate = useNavigate();
  useEffect(() => {
    let cancelled = false;
    setState('checking');
    fetchFn(`/rooms/${encodeURIComponent(officeId)}/sessions?login=${encodeURIComponent(login)}`)
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
    cancel: () => {
      setState('cancelled');
      navigate('/');
    },
  };
}
