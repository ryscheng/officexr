// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Identity, Office } from '@officexr/server/shared';
import { officeSettingsTabs } from './OfficeSettings';
import { openSettings as openSettingsModal, SettingsHarness } from './settingsHarness';

beforeEach(() => {
  // jsdom lacks it; Radix's Switch measures its form-mirroring input with one.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);

const office: Office = {
  id: 'o1',
  name: 'HQ',
  description: 'Main',
  map_name: 'hq',
  created_by_login: 'a@example.com',
  debug_enabled: false,
};
const alice = { login: 'a@example.com', name: 'Alice' };

function Harness({ me, onSaved }: { me: Identity; onSaved: (office: Office) => void }) {
  return <SettingsHarness tabs={officeSettingsTabs(office, me, onSaved)} />;
}

const openSettings = () => {
  openSettingsModal();
  fireEvent.click(screen.getByRole('tab', { name: 'Office' }));
};

function setup(me = alice, patch: (init: RequestInit) => Promise<Response> = () => json(200, office)) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) =>
    init?.method === 'PATCH' ? patch(init) : json(200, { maps: [{ name: 'default' }, { name: 'hq' }] }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const onSaved = vi.fn();
  render(<Harness me={me} onSaved={onSaved} />);
  return { fetchMock, onSaved };
}

describe('OfficeSettings', () => {
  it('offers the Office tab only to the creator', () => {
    setup({ login: 'b@example.com', name: 'Bob' });
    openSettingsModal();
    expect(screen.queryByRole('tab', { name: 'Office' })).toBeNull();
    cleanup();
    setup();
    openSettings();
    expect(screen.getByLabelText('Name')).toBeTruthy();
  });

  it('saves the edited settings and reports the updated office, keeping Settings open', async () => {
    const updated = { ...office, name: 'Lab', map_name: 'default', debug_enabled: true };
    const { fetchMock, onSaved } = setup(alice, () => json(200, updated));
    openSettings();
    await screen.findByRole('option', { name: 'default' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Lab' } });
    fireEvent.change(screen.getByLabelText('Map'), { target: { value: 'default' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Debug mode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated));
    expect((await screen.findByRole('status')).textContent).toBe('Saved');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Lab 2' } });
    expect(screen.queryByRole('status')).toBeNull();
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH')!;
    expect(url).toBe('/api/offices/o1');
    expect(JSON.parse(init!.body as string)).toEqual({ name: 'Lab', mapName: 'default', debugEnabled: true });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('sends nothing for untouched fields', async () => {
    const { fetchMock, onSaved } = setup();
    openSettings();
    fireEvent.click(screen.getByRole('switch', { name: 'Debug mode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH')!;
    expect(JSON.parse(init!.body as string)).toEqual({ debugEnabled: true });
  });

  it('Cancel resets the fields without closing Settings', async () => {
    setup();
    openSettings();
    await screen.findByRole('option', { name: 'default' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Lab' } });
    fireEvent.change(screen.getByLabelText('Map'), { target: { value: 'default' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Debug mode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('HQ');
    expect((screen.getByLabelText('Map') as HTMLSelectElement).value).toBe('hq');
    expect(screen.getByRole('switch', { name: 'Debug mode' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it("shows the server's error and keeps the form", async () => {
    const { onSaved } = setup(alice, () => json(403, { error: 'Only the office creator can change its settings' }));
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Only the office creator can change its settings');
    expect(onSaved).not.toHaveBeenCalled();
  });
});
