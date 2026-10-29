// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { useWorldFocus } from '@officexr/world/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Identity, Office } from '../../server/api';
import { OfficeSettingsDialog, OfficeSettingsMenuItem } from './OfficeSettings';
import { RoomMenu } from './RoomMenu';

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
  const focused = useWorldFocus();
  const [open, setOpen] = useState(false);
  return (
    <>
      <output>{String(focused)}</output>
      <RoomMenu>
        <OfficeSettingsMenuItem office={office} me={me} onSelect={() => setOpen(true)} />
      </RoomMenu>
      {open && <OfficeSettingsDialog office={office} me={me} onSaved={onSaved} onClose={() => setOpen(false)} />}
    </>
  );
}

const openSettings = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
  fireEvent.click(screen.getByRole('button', { name: 'Office settings…' }));
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
  it('offers Office settings in the menu only to the creator, with no button outside it', () => {
    setup({ login: 'b@example.com', name: 'Bob' });
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.queryByRole('button', { name: 'Office settings…' })).toBeNull();
    cleanup();
    setup();
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
    openSettings();
    expect(screen.getByRole('dialog', { name: 'Office settings' })).toBeTruthy();
  });

  it('renders no dialog for anyone but the creator', () => {
    const bob = { login: 'b@example.com', name: 'Bob' };
    render(<OfficeSettingsDialog office={office} me={bob} onSaved={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('saves the edited settings and reports the updated office', async () => {
    const updated = { ...office, name: 'Lab', map_name: 'default', debug_enabled: true };
    const { fetchMock, onSaved } = setup(alice, () => json(200, updated));
    openSettings();
    await screen.findByRole('option', { name: 'default' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Lab' } });
    fireEvent.change(screen.getByLabelText('Map'), { target: { value: 'default' } });
    fireEvent.click(screen.getByLabelText(/Debug mode/));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated));
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH')!;
    expect(url).toBe('/api/offices/o1');
    expect(JSON.parse(init!.body as string)).toEqual({ name: 'Lab', mapName: 'default', debugEnabled: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('true');
  });

  it('applies a save that lands after the dialog closed without closing or unfocusing what opened since', async () => {
    let respond!: (res: Response) => void;
    const { onSaved } = setup(alice, () => new Promise<Response>((resolve) => (respond = resolve)));
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    openSettings();
    expect(screen.getByRole('status').textContent).toBe('false');
    const updated = { ...office, name: 'Lab' };
    respond({ ok: true, status: 200, json: async () => updated } as Response);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated));
    expect(screen.getByRole('dialog', { name: 'Office settings' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('false');
  });

  it('sends nothing for untouched fields', async () => {
    const { fetchMock } = setup();
    openSettings();
    fireEvent.click(screen.getByLabelText(/Debug mode/));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH')!;
    expect(JSON.parse(init!.body as string)).toEqual({ debugEnabled: true });
  });

  it('moves focus into the dialog and closes on Escape, handing the keyboard back to the world', () => {
    setup();
    openSettings();
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    expect(screen.getByRole('status').textContent).toBe('false');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('true');
  });

  it("shows the server's error and keeps the dialog open", async () => {
    const { onSaved } = setup(alice, () => json(403, { error: 'Only the office creator can change its settings' }));
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Only the office creator can change its settings');
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
