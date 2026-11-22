// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

function meFailsAt(url: string, status: number, error: string) {
  window.history.pushState({}, '', url);
  vi.stubGlobal(
    'fetch',
    vi.fn((target: string) =>
      Promise.resolve({
        ok: false,
        status: target === '/api/me' ? status : 200,
        json: async () => (target === '/api/me' ? { error } : []),
      } as Response),
    ),
  );
  render(<App />);
}

const signedOutAt = (url: string) => meFailsAt(url, 401, 'Not signed in');

describe('App signed out', () => {
  it.each(['/', '/room/abc?x=1'])('shows a sign-in link back to %s', async (path) => {
    signedOutAt(path);
    const link = await screen.findByRole('link', { name: 'Continue with Google' });
    expect(link.getAttribute('href')).toBe(`/auth/google?next=${encodeURIComponent(path)}`);
  });

  it('drops login_error from the return path', async () => {
    signedOutAt('/?login_error=x&foo=1');
    const link = await screen.findByRole('link', { name: 'Continue with Google' });
    expect(link.getAttribute('href')).toBe('/auth/google?next=%2F%3Ffoo%3D1');
  });

  it('shows the blocked screen with Try again for a non-401 /api/me failure', async () => {
    meFailsAt('/', 500, 'Boom');
    expect((await screen.findByRole('alert')).textContent).toBe('We can not reach the office');
    expect(screen.getByText('Details').closest('details')!.textContent).toContain('Boom');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('retries /api/me from the blocked screen', async () => {
    meFailsAt('/', 500, 'Boom');
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await screen.findByText('Loading…');
  });

  it.each([
    ['not_allowed', 'This account is not on the list yet. Ask the person who invited you, or an admin, to add your Google address. Then try again.'],
    ['unverified', 'Google says this email is not verified. Verify it in your Google account, then try again.'],
    ['failed', 'Sign-in did not finish. This is usually a short problem. Try again.'],
    ['anything_else', 'Sign-in did not finish. This is usually a short problem. Try again.'],
  ])('renders the message for login_error=%s', async (code, message) => {
    signedOutAt(`/?login_error=${code}`);
    expect((await screen.findByRole('alert')).textContent).toBe(message);
  });

  it('shows the offline state with the button still enabled', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    signedOutAt('/');
    expect((await screen.findByRole('alert')).textContent).toBe('You are offline. Connect to the internet, then try again.');
    expect(screen.getByRole('link', { name: 'Continue with Google' }).getAttribute('aria-disabled')).toBe('false');
  });

  it('saves the room link before leaving for Google', async () => {
    signedOutAt('/room/abc?x=1');
    const link = await screen.findByRole('link', { name: 'Continue with Google' });
    link.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(link);
    expect(sessionStorage.getItem('officexr:signInNext')).toBe('/room/abc?x=1');
    expect(screen.getByText('Opening Google…')).toBeTruthy();
  });

  it('still signs in when the store throws', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    signedOutAt('/room/abc');
    const link = await screen.findByRole('link', { name: 'Continue with Google' });
    link.addEventListener('click', (e) => e.preventDefault());
    expect(() => fireEvent.click(link)).not.toThrow();
  });

  it('keeps the room link after a failed sign-in on /', async () => {
    sessionStorage.setItem('officexr:signInNext', '/room/abc?x=1');
    signedOutAt('/?login_error=failed');
    const link = await screen.findByRole('link', { name: 'Continue with Google' });
    expect(link.getAttribute('href')).toBe(`/auth/google?next=${encodeURIComponent('/room/abc?x=1')}`);
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/room/abc?x=1'));
    expect(screen.getByRole('link', { name: 'Back to your office link' }).getAttribute('href')).toBe('/room/abc?x=1');
    expect(screen.getByText('You opened an office link')).toBeTruthy();
  });

  describe('invite line', () => {
    const withLookup = (path: string, lookup: () => Promise<Response>) => {
      window.history.pushState({}, '', path);
      const fetchMock = vi.fn((target: string) =>
        target === '/api/me'
          ? Promise.resolve({ ok: false, status: 401, json: async () => ({ error: 'Not signed in' }) } as Response)
          : lookup(),
      );
      vi.stubGlobal('fetch', fetchMock);
      render(<App />);
      return fetchMock;
    };
    const named = (name: unknown) => () => Promise.resolve({ ok: true, status: 200, json: async () => ({ name }) } as Response);

    it('names the office from the public lookup', async () => {
      const fetchMock = withLookup('/room/11111111-1111-4111-8111-111111111111', named('Design studio'));
      expect(await screen.findByText('Design studio')).toBeTruthy();
      expect(screen.getByText(/You are invited to/).textContent).toBe('You are invited to Design studio');
      expect(fetchMock).toHaveBeenCalledWith('/api/offices/11111111-1111-4111-8111-111111111111/name', expect.anything());
    });

    it.each([
      ['a 404', () => Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'Office not found' }) } as Response)],
      ['a network failure', () => Promise.reject(new Error('offline'))],
      ['a body without a name', named(undefined)],
      ['a blank name', named('  ')],
    ])('keeps the current text after %s', async (_label, lookup) => {
      const fetchMock = withLookup('/room/abc', lookup);
      await screen.findByRole('link', { name: 'Continue with Google' });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(screen.getByText('You opened an office link')).toBeTruthy();
      expect(screen.queryByText(/You are invited to/)).toBeNull();
    });

    it('does not look anything up away from a room link', async () => {
      const fetchMock = withLookup('/', named('x'));
      await screen.findByRole('link', { name: 'Continue with Google' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('shows the plain error when the store throws on read', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    signedOutAt('/?login_error=failed');
    expect((await screen.findByRole('alert')).textContent).toContain('Sign-in did not finish.');
    expect(screen.queryByRole('link', { name: 'Back to your office link' })).toBeNull();
  });
});

describe('App signed in', () => {
  it('shows the page-not-found screen for an unknown path', async () => {
    window.history.pushState({}, '', '/nowhere?a=1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ login: 'a@example.com', name: 'A' }) }) as Response),
    );
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toBe('This page does not exist');
    expect(screen.getByText('Details').closest('details')!.textContent).toContain('/nowhere?a=1');
    expect(screen.getByRole('link', { name: 'Go to offices' }).getAttribute('href')).toBe('/');
  });

  it('shows the office-not-found screen for a 404 office', async () => {
    window.history.pushState({}, '', '/room/gone');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (target: string) =>
        target === '/api/me'
          ? ({ ok: true, status: 200, json: async () => ({ login: 'a@example.com', name: 'A' }) } as Response)
          : ({ ok: false, status: 404, json: async () => ({ error: 'Not found' }) } as Response),
      ),
    );
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toBe('We can not find this office');
    expect(screen.getByText('Details').closest('details')!.textContent).toContain('HTTP 404');
  });

  it('shows the offline screen with Try again when the office request never answers', async () => {
    window.history.pushState({}, '', '/room/x');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (target: string) => {
        if (target === '/api/me') {
          return { ok: true, status: 200, json: async () => ({ login: 'a@example.com', name: 'A' }) } as Response;
        }
        throw new TypeError('Failed to fetch');
      }),
    );
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toBe('You are offline');
    expect(screen.getByText('Details').closest('details')!.textContent).toContain('Failed to fetch');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('App entering a room', () => {
  it('shows step 1 of 4 while the sign-in check is pending, and a plain spinner elsewhere', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    window.history.pushState({}, '', '/room/abc');
    render(<App />);
    expect(screen.getByRole('status').textContent).toBe('Step 1 of 4: checking your sign-in');
    cleanup();
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(screen.getByRole('status').textContent).toBe('Loading…');
  });
});
