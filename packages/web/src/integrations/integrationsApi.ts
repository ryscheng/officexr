import { apiFetch } from '../apiOrigin';

export interface IntegrationsStatus {
  calendar: { enabled: boolean; connected: boolean };
  slack: { enabled: boolean };
}

export const NO_INTEGRATIONS: IntegrationsStatus = { calendar: { enabled: false, connected: false }, slack: { enabled: false } };

export async function fetchIntegrations(fetchFn: typeof apiFetch = apiFetch): Promise<IntegrationsStatus> {
  try {
    const res = await fetchFn('/api/integrations');
    return res.ok ? ((await res.json()) as IntegrationsStatus) : NO_INTEGRATIONS;
  } catch {
    return NO_INTEGRATIONS;
  }
}

export async function disconnectCalendar(fetchFn: typeof apiFetch = apiFetch): Promise<boolean> {
  try {
    return (await fetchFn('/api/calendar', { method: 'DELETE' })).ok;
  } catch {
    return false;
  }
}

export async function slackPing(officeId: string, targetLogin: string, fetchFn: typeof apiFetch = apiFetch): Promise<void> {
  await fetchFn(`/api/offices/${encodeURIComponent(officeId)}/slack-ping`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ targetLogin }),
  }).catch(() => undefined);
}

export const calendarConnectPath = (returnTo: string) => `/auth/google/calendar?next=${encodeURIComponent(returnTo)}`;
