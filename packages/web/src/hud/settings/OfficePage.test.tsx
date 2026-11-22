// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Office } from '@officexr/server/shared';
import { OfficePage, STUDIO_URL } from './OfficePage';

beforeEach(() => {
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) => Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);

const office: Office = { id: 'o1', name: 'HQ', description: 'Main', map_name: 'hq', created_by_login: 'a@example.com', debug_enabled: false };

function setup(coarse = false, patch: (init: RequestInit) => Promise<Response> = () => json(200, office)) {
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => (init?.method === 'PATCH' ? patch(init) : json(200, { maps: [{ name: 'default' }, { name: 'hq' }] })));
  vi.stubGlobal('fetch', fetchMock);
  const onSaved = vi.fn();
  render(<OfficePage office={office} coarse={coarse} onSaved={onSaved} />);
  const patches = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'PATCH').map(([, i]) => JSON.parse(i!.body as string) as unknown);
  return { onSaved, patches };
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

describe('OfficePage', () => {
  it('saves a changed name and description without asking, and says Saved', async () => {
    const { onSaved, patches } = setup(false, () => json(200, { ...office, name: 'Lab' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Lab' } });
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ...office, name: 'Lab' }));
    expect((await screen.findByRole('status')).textContent).toBe('Saved');
    expect(patches()).toEqual([{ name: 'Lab' }]);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Lab 2' } });
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('asks before changing the map, and Cancel sends nothing', async () => {
    const { patches } = setup();
    await screen.findByRole('option', { name: 'default' });
    fireEvent.change(screen.getByLabelText('Map'), { target: { value: 'default' } });
    save();
    const dialog = await screen.findByRole('dialog', { name: 'Change the map for everyone in HQ?' });
    expect(dialog).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(patches()).toEqual([]);
  });

  it('changes the map after Change map and counts down an Undo that restores the old map', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { onSaved, patches } = setup(false, () => json(200, { ...office, map_name: 'default' }));
    await screen.findByRole('option', { name: 'default' });
    fireEvent.change(screen.getByLabelText('Map'), { target: { value: 'default' } });
    save();
    fireEvent.click(await screen.findByRole('button', { name: 'Change map' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(patches()).toEqual([{ mapName: 'default' }]);
    expect(await screen.findByText('Map changed.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo (5 s)' })).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByRole('button', { name: /^Undo \([2-3] s\)$/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Undo/ }));
    await waitFor(() => expect(patches()).toEqual([{ mapName: 'default' }, { mapName: 'hq' }]));
    expect(screen.queryByText('Map changed.')).toBeNull();
    await waitFor(() => expect((screen.getByLabelText('Map') as HTMLSelectElement).value).toBe('hq'));
  });

  it('removes the Undo toast after 5 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup(false, () => json(200, { ...office, map_name: 'default' }));
    await screen.findByRole('option', { name: 'default' });
    fireEvent.change(screen.getByLabelText('Map'), { target: { value: 'default' } });
    save();
    fireEvent.click(await screen.findByRole('button', { name: 'Change map' }));
    await screen.findByText('Map changed.');
    await act(() => vi.advanceTimersByTimeAsync(5100));
    expect(screen.queryByText('Map changed.')).toBeNull();
  });

  it('shows the error component and keeps the typed text when saving fails', async () => {
    const { onSaved } = setup(false, () => json(500, { error: 'Boom' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Lab' } });
    save();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('We could not save.');
    expect(alert.textContent).toContain('Check your connection and try again.');
    expect(alert.textContent).toContain('Boom');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Lab');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('disables Save while offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    setup();
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('You are offline.')).toBeTruthy();
    vi.restoreAllMocks();
  });

  it('keeps Debug mode inside a closed Advanced fold and saves the switch at once', async () => {
    const { patches } = setup();
    const fold = screen.getByRole('button', { name: 'Advanced' });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('switch', { name: 'Debug mode' })).toBeNull();
    fireEvent.click(fold);
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Lets you join from several windows.')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Debug mode' }));
    await waitFor(() => expect(patches()).toEqual([{ debugEnabled: true }]));
  });
});

describe('Show performance', () => {
  it('sits next to Debug mode in Advanced and turns the readout on and off', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    const toggle = screen.getByRole('switch', { name: 'Show performance' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByRole('switch', { name: 'Show performance' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('switch', { name: 'Show performance' }));
    expect(screen.getByRole('switch', { name: 'Show performance' }).getAttribute('aria-checked')).toBe('false');
  });
});

describe('Open studio', () => {
  it('links to the studio in a new tab for every user', () => {
    setup();
    const link = screen.getByRole('link', { name: /Open studio/ });
    expect(link.getAttribute('href')).toBe(STUDIO_URL);
    expect(STUDIO_URL).toBe('https://officexr.karibalabs.co/studio/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener');
    expect(link.textContent).toContain('Edit maps and objects');
  });

  it('says the studio works best on a large screen on a phone, and what happens on desktop', () => {
    setup(true);
    expect(screen.getByText('The studio works best on a large screen.')).toBeTruthy();
    cleanup();
    setup(false);
    expect(screen.getByText('Opens in a new tab. If you are not on the studio list, it tells you.')).toBeTruthy();
  });
});
