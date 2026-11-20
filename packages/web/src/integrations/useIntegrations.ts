import { useCallback, useEffect, useState } from 'react';
import { disconnectCalendar, fetchIntegrations, NO_INTEGRATIONS, type IntegrationsStatus } from './integrationsApi';

export interface Integrations {
  status: IntegrationsStatus;
  disconnectCalendar: () => Promise<void>;
}

export function useIntegrations(): Integrations {
  const [status, setStatus] = useState<IntegrationsStatus>(NO_INTEGRATIONS);
  useEffect(() => {
    let cancelled = false;
    void fetchIntegrations().then((next) => {
      if (!cancelled) {
        setStatus(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const disconnect = useCallback(async () => {
    if (await disconnectCalendar()) {
      setStatus((prev) => ({ ...prev, calendar: { ...prev.calendar, connected: false } }));
    }
  }, []);
  return { status, disconnectCalendar: disconnect };
}
