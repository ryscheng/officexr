// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
    const link = await screen.findByRole('link', { name: 'Sign in with Google' });
    expect(link.getAttribute('href')).toBe(`/auth/google?next=${encodeURIComponent(path)}`);
  });

  it('drops login_error from the return path', async () => {
    signedOutAt('/?login_error=x&foo=1');
    const link = await screen.findByRole('link', { name: 'Sign in with Google' });
    expect(link.getAttribute('href')).toBe('/auth/google?next=%2F%3Ffoo%3D1');
  });

  it('keeps the normal error UI for non-401 /api/me failures', async () => {
    meFailsAt('/', 500, 'Boom');
    expect(await screen.findByText('Boom')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Sign in with Google' })).toBeNull();
  });

  it.each([
    ['not_allowed', "This Google account isn't allowed to use OfficeXR. Ask an admin to add it."],
    ['unverified', "Your Google email address isn't verified."],
    ['failed', 'Sign-in failed, please try again.'],
    ['anything_else', 'Sign-in failed, please try again.'],
  ])('renders the message for login_error=%s', async (code, message) => {
    signedOutAt(`/?login_error=${code}`);
    expect((await screen.findByRole('alert')).textContent).toBe(message);
  });
});
