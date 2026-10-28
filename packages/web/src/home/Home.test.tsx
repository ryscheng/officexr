// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Identity, Office } from '../../server/api';
import type { ApiState } from '../useApi';
import { Home } from './Home';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);

const ready: ApiState<Identity> = { type: 'ready', data: { login: 'a@example.com', name: 'Alice' } };
const unidentified: ApiState<Identity> = { type: 'error', message: 'Not signed in' };

function setup(me: ApiState<Identity>, offices: Office[] | number, post?: (init: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) =>
    url === '/api/offices' && init?.method === 'POST'
      ? post!(init)
      : url === '/api/offices'
        ? typeof offices === 'number'
          ? json(offices, { error: 'Boom' })
          : json(200, offices)
        : json(200, { maps: [{ name: 'default' }, { name: 'hq' }] }),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<Home me={me} />} />
        <Route path="/room/:id" element={<p>In office</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Home', () => {
  it('points at the create form when there are no offices', async () => {
    setup(ready, []);
    expect(await screen.findByText(/No offices yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create office' })).toBeTruthy();
  });

  it('renders office cards with name, description and map linking to the office', async () => {
    setup(ready, [
      { id: 'o1', name: 'HQ', description: 'Main', map_name: 'hq', created_by_login: null, debug_enabled: false },
      { id: 'o2', name: 'Annex', description: null, map_name: null, created_by_login: null, debug_enabled: false },
    ]);
    const hq = (await screen.findByText('HQ')).closest('a');
    expect(hq?.getAttribute('href')).toBe('/room/o1');
    expect(hq?.textContent).toContain('Main');
    expect(hq?.textContent).toContain('Map: hq');
    expect(screen.getByText('Annex').closest('a')?.textContent).toContain('Map: default');
  });

  it('shows an error in place of the list when offices fail to load', async () => {
    setup(ready, 500);
    expect((await screen.findByRole('alert')).textContent).toBe('Boom');
  });

  it('still lists offices and disables the form when /api/me fails', async () => {
    setup(unidentified, [{ id: 'o1', name: 'HQ', description: null, map_name: 'hq', created_by_login: null, debug_enabled: false }]);
    expect(await screen.findByText('HQ')).toBeTruthy();
    expect(screen.getAllByText('Not signed in').length).toBeGreaterThan(0);
    expect(screen.getByText(/requires signing in/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create office' })).matches(':disabled')).toBe(true);
  });

  it('signs out by POSTing /auth/logout then returning to /', async () => {
    const assign = vi.fn();
    setup(ready, []);
    vi.stubGlobal('location', { assign });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/auth/logout', { method: 'POST' });
  });

  it('keeps the user signed in and shows the error when sign-out fails', async () => {
    const assign = vi.fn();
    setup(ready, []);
    vi.stubGlobal('location', { assign });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementationOnce(() => json(500, { error: 'Logout broke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Logout broke');
    expect(assign).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Sign out' })).matches(':disabled')).toBe(false);
  });

  it('creates an office and navigates into it', async () => {
    const post = vi.fn(() => json(201, { id: 'new', name: 'Lab', description: null, map_name: 'hq', created_by_login: null, debug_enabled: false }));
    setup(ready, [], post);
    await screen.findByRole('option', { name: 'hq' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Lab' } });
    fireEvent.change(screen.getByLabelText('Map'), { target: { value: 'hq' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create office' }));
    expect(await screen.findByText('In office')).toBeTruthy();
    expect(JSON.parse((post.mock.calls[0] as unknown as [RequestInit])[0].body as string)).toMatchObject({
      name: 'Lab',
      mapName: 'hq',
    });
  });

  it("shows the server's error when creating fails", async () => {
    setup(ready, [], () => json(400, { error: 'Unknown map' }));
    await screen.findByRole('option', { name: 'hq' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Lab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create office' }));
    await waitFor(() => expect(screen.getByText('Unknown map')).toBeTruthy());
  });
});
