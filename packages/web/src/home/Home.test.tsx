// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Identity, Office } from '@officexr/server/shared';
import type { ApiState } from '../useApi';
import { Home } from './Home';
import { lastVisitedLabel, recordVisit } from './visits';

vi.mock('@officexr/world/top-down', () => ({ usePortrait: () => false }));

beforeEach(() => {
  sessionStorage.setItem('officexr:landed', '1');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

const json = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{`In office ${pathname}${search}`}</p>;
}

const ready: ApiState<Identity> = { type: 'ready', data: { login: 'a@example.com', name: 'Alice' } };
const unidentified: ApiState<Identity> = { type: 'error', message: 'Not signed in' };

const office = (id: string, name: string, description: string | null = null): Office => ({
  id,
  name,
  description,
  map_name: 'default',
  created_by_login: null,
  debug_enabled: false,
});

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
        <Route path="/room/:id" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const newOffice = () => fireEvent.click(screen.getAllByRole('button', { name: 'New office' })[0]);

describe('office list', () => {
  it('says so and offers New office when there are no offices', async () => {
    setup(ready, []);
    expect(await screen.findByText('No offices yet. Create the first one to get your team in.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'New office' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('shows each office as one link with name and description, without a map picker', async () => {
    setup(ready, [office('o1', 'HQ', 'Main'), office('o2', 'Annex')]);
    const hq = (await screen.findByText('HQ')).closest('a');
    expect(hq?.getAttribute('href')).toBe('/room/o1');
    expect(hq?.getAttribute('title')).toBe('HQ\nMain');
    expect(hq?.textContent).toContain('Main');
    expect(screen.queryByLabelText('Map for HQ')).toBeNull();
  });

  it('lists the last visited office first, then the rest by name, with a pill', async () => {
    recordVisit('o3', new Date());
    setup(ready, [office('o1', 'Beta'), office('o2', 'Alpha'), office('o3', 'Zed')]);
    await screen.findByText('Zed');
    expect(screen.getAllByRole('link', { name: /./ }).filter((a) => a.getAttribute('href') !== '/').map((a) => a.getAttribute('href'))).toEqual(['/room/o3', '/room/o2', '/room/o1']);
    expect(screen.getByText('Last visited today')).toBeTruthy();
  });

  it('shows search only from four offices and filters by name and description', async () => {
    setup(ready, [office('1', 'Alpha'), office('2', 'Beta'), office('3', 'Gamma', 'quiet floor'), office('4', 'Delta')]);
    const search = await screen.findByRole('searchbox', { name: 'Search offices' });
    fireEvent.change(search, { target: { value: 'quiet' } });
    expect(screen.getAllByRole('link', { name: /./ }).filter((a) => a.getAttribute('href') !== '/').map((a) => a.getAttribute('href'))).toEqual(['/room/3']);
    fireEvent.change(search, { target: { value: 'nothing' } });
    expect(screen.getByText('No offices match.')).toBeTruthy();
  });

  it('has no search with three offices', async () => {
    setup(ready, [office('1', 'A'), office('2', 'B'), office('3', 'C')]);
    await screen.findByText('A');
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('shows a plain error with Try again, and the raw text only under Details', async () => {
    setup(ready, 500);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('We could not load the offices.');
    expect(alert.textContent).toContain('Check your connection and try again.');
    expect(within(alert).getByText('Boom').closest('details')).toBeTruthy();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((url) => json(200, url === '/api/offices' ? [office('o1', 'HQ')] : { maps: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('HQ')).toBeTruthy();
  });

  it('skips the list to the last visited office on the first landing only', async () => {
    sessionStorage.clear();
    recordVisit('o2', new Date());
    setup(ready, [office('o1', 'A'), office('o2', 'B')]);
    expect(await screen.findByText('In office /room/o2')).toBeTruthy();
    cleanup();
    setup(ready, [office('o1', 'A'), office('o2', 'B')]);
    expect(await screen.findByText('B')).toBeTruthy();
  });

  it('keeps the list when the last visited office no longer exists', async () => {
    sessionStorage.clear();
    recordVisit('gone', new Date());
    setup(ready, [office('o1', 'A')]);
    expect(await screen.findByText('A')).toBeTruthy();
  });

  it('still lists offices when /api/me fails', async () => {
    setup(unidentified, [office('o1', 'HQ')]);
    expect(await screen.findByText('HQ')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });
});

describe('last visited label', () => {
  const now = new Date(2026, 10, 21, 12);
  it('names today, yesterday, then the date', () => {
    expect(lastVisitedLabel(new Date(2026, 10, 21, 1).toISOString(), now)).toBe('Last visited today');
    expect(lastVisitedLabel(new Date(2026, 10, 20, 23).toISOString(), now)).toBe('Last visited yesterday');
    expect(lastVisitedLabel(new Date(2026, 10, 3).toISOString(), now)).toMatch(/^Last visited .*3/);
    expect(lastVisitedLabel(undefined, now)).toBeNull();
    expect(lastVisitedLabel('nonsense', now)).toBeNull();
  });
  it('survives storage that throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => recordVisit('o1')).not.toThrow();
  });
});

describe('sign out', () => {
  it('POSTs /auth/logout then returns to /', async () => {
    const assign = vi.fn();
    setup(ready, []);
    vi.stubGlobal('location', { assign });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/auth/logout', { credentials: 'include', method: 'POST' });
  });

  it('keeps the user signed in and shows the error when it fails', async () => {
    const assign = vi.fn();
    setup(ready, []);
    vi.stubGlobal('location', { assign });
    vi.mocked(fetch).mockImplementationOnce(() => json(500, { error: 'Logout broke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Logout broke');
    expect(assign).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Sign out' })).matches(':disabled')).toBe(false);
  });
});

describe('new office', () => {
  const open = async (offices: Office[] = []) => {
    setup(ready, offices, undefined);
    await screen.findByRole('searchbox').catch(() => screen.findByText(/No offices yet/));
    newOffice();
    return screen.findByRole('dialog', { name: 'New office' });
  };

  it('opens with the name focused and the extra fields folded', async () => {
    const dialog = await open();
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Name'));
    const more = within(dialog).getByRole('button', { name: 'More options' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(within(dialog).getByLabelText('Description (optional)').closest('[hidden]')).toBeTruthy();
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(within(dialog).getByLabelText('Description (optional)').closest('[hidden]')).toBeNull();
  });

  it('asks for a name instead of sending an empty one', async () => {
    const dialog = await open();
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: '   ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create office' }));
    expect(within(dialog).getByText('Give the office a name.')).toBeTruthy();
    expect(within(dialog).getByLabelText('Name').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Name'));
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('counts characters from 80 and stops at 100', async () => {
    const dialog = await open();
    const name = within(dialog).getByLabelText('Name') as HTMLInputElement;
    expect(within(dialog).getByText('Up to 100 characters.')).toBeTruthy();
    fireEvent.change(name, { target: { value: 'x'.repeat(80) } });
    expect(within(dialog).getByText('80 / 100')).toBeTruthy();
    expect(name.maxLength).toBe(100);
  });

  it('closes with Cancel and Close', async () => {
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    newOffice();
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('creates with a name only and goes into the office with the invite flag', async () => {
    const post = vi.fn(() => json(201, office('new', 'Lab')));
    setup(ready, [], post);
    await screen.findByText(/No offices yet/);
    newOffice();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Lab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create office' }));
    expect(await screen.findByText('In office /room/new?invite=1')).toBeTruthy();
    expect(JSON.parse((post.mock.calls[0] as unknown as [RequestInit])[0].body as string)).toMatchObject({
      name: 'Lab',
      mapName: 'default',
    });
  });

  it('sends the description and map from More options', async () => {
    const post = vi.fn(() => json(201, office('new', 'Lab')));
    setup(ready, [], post);
    await screen.findByText(/No offices yet/);
    newOffice();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Lab' } });
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.change(screen.getByLabelText('Description (optional)'), { target: { value: 'Hangout' } });
    await screen.findByRole('option', { name: 'hq' });
    fireEvent.change(screen.getByLabelText('Map'), { target: { value: 'hq' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create office' }));
    await screen.findByText('In office /room/new?invite=1');
    expect(JSON.parse((post.mock.calls[0] as unknown as [RequestInit])[0].body as string)).toEqual({
      name: 'Lab',
      description: 'Hangout',
      mapName: 'hq',
    });
  });

  it('shows Creating and locks the fields while it waits', async () => {
    setup(ready, [], () => new Promise(() => undefined));
    await screen.findByText(/No offices yet/);
    newOffice();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Lab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create office' }));
    expect((await screen.findByRole('button', { name: 'Creating…' })).matches(':disabled')).toBe(true);
    expect(screen.getByLabelText('Name').matches(':disabled')).toBe(true);
  });

  it('keeps the text and shows a plain error with the server text under Details when creating fails', async () => {
    setup(ready, [], () => json(400, { error: 'Unknown map' }));
    await screen.findByText(/No offices yet/);
    newOffice();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Lab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create office' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('We could not create the office.');
    expect(within(alert).getByText('Unknown map').closest('details')).toBeTruthy();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Lab');
    expect((screen.getByRole('button', { name: 'Create office' })).matches(':disabled')).toBe(false);
  });

  it('cannot create when signed out', async () => {
    setup(unidentified, []);
    await screen.findByText(/No offices yet/);
    newOffice();
    expect(await screen.findByText(/requires signing in/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create office' })).matches(':disabled')).toBe(true);
  });
});
