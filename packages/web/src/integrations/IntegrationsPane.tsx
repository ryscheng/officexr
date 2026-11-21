import { apiUrl } from '../apiOrigin';
import { SettingRow } from '../hud/settings/parts';
import { calendarConnectPath } from './integrationsApi';
import type { Integrations } from './useIntegrations';

const buttonClass =
  'inline-flex min-h-12 items-center rounded-lg bg-hud-inset px-4 text-sm font-semibold hover:bg-hud-hover focus-visible:outline-2 focus-visible:outline-hud-accent';

export function IntegrationsPane({ integrations, returnTo }: { integrations: Integrations; returnTo: string }) {
  const { calendar } = integrations.status;
  if (!calendar.enabled) {
    return null;
  }
  return (
    <SettingRow label="Calendar">
      <span className="text-sm text-hud-text-2">{calendar.connected ? 'Connected' : 'Not connected'}</span>
      {calendar.connected ? (
        <button type="button" className={buttonClass} onClick={() => void integrations.disconnectCalendar()}>
          Disconnect
        </button>
      ) : (
        <a className={buttonClass} href={apiUrl(calendarConnectPath(returnTo))}>
          Connect
        </a>
      )}
    </SettingRow>
  );
}
