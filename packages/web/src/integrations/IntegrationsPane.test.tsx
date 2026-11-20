// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { calendarConnectPath, disconnectCalendar, fetchIntegrations, NO_INTEGRATIONS, slackPing } from './integrationsApi';
import { IntegrationsPane } from './IntegrationsPane';
import type { Integrations } from './useIntegrations';

afterEach(cleanup);

const integrations = (connected: boolean, enabled = true): Integrations => ({
  status: { calendar: { enabled, connected }, slack: { enabled: false } },
  disconnectCalendar: vi.fn(async () => undefined),
});

describe('IntegrationsPane', () => {
  it('renders nothing when the calendar integration is off', () => {
    const { container } = render(<IntegrationsPane integrations={integrations(false, false)} returnTo="/room/x" />);
    expect(container.innerHTML).toBe('');
  });

  it('offers Connect, which starts the calendar consent and returns to this office', () => {
    render(<IntegrationsPane integrations={integrations(false)} returnTo="/room/x?a=1" />);
    expect(screen.getByText('Not connected')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Connect' }).getAttribute('href')).toBe('/auth/google/calendar?next=%2Froom%2Fx%3Fa%3D1');
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
  });

  it('offers Disconnect once connected', () => {
    const connected = integrations(true);
    render(<IntegrationsPane integrations={connected} returnTo="/room/x" />);
    expect(screen.getByText('Connected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(connected.disconnectCalendar).toHaveBeenCalledOnce();
    expect(screen.queryByRole('link', { name: 'Connect' })).toBeNull();
  });
});

describe('integrationsApi', () => {
  const reply = (status: number, body?: unknown) => vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));

  it('reads what is on, and treats any failure as everything off', async () => {
    const on = { calendar: { enabled: true, connected: false }, slack: { enabled: true } };
    expect(await fetchIntegrations(reply(200, on))).toEqual(on);
    expect(await fetchIntegrations(reply(401, { error: 'Not signed in' }))).toEqual(NO_INTEGRATIONS);
    expect(await fetchIntegrations(vi.fn(async () => Promise.reject(new Error('offline'))))).toEqual(NO_INTEGRATIONS);
  });

  it('disconnects with DELETE /api/calendar', async () => {
    const fetchFn = reply(204);
    expect(await disconnectCalendar(fetchFn)).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith('/api/calendar', { method: 'DELETE' });
    expect(await disconnectCalendar(reply(500))).toBe(false);
  });

  it('posts the Slack ping for the office and never throws', async () => {
    const fetchFn = reply(200, { sent: true });
    await slackPing('office-1', 'bob@example.com', fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('/api/offices/office-1/slack-ping', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetLogin: 'bob@example.com' }),
    });
    await expect(slackPing('office-1', 'bob@example.com', vi.fn(async () => Promise.reject(new Error('offline'))))).resolves.toBeUndefined();
  });

  it('builds the connect path with an encoded return target', () => {
    expect(calendarConnectPath('/room/a b')).toBe('/auth/google/calendar?next=%2Froom%2Fa%20b');
  });
});
