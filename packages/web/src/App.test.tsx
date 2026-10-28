// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function signedOutAt(url: string) {
  window.history.pushState({}, '', url);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: false, status: 401, json: async () => ({ error: 'Not signed in' }) } as Response)),
  );
  render(<App />);
}

describe('App signed out', () => {
  it.each(['/', '/room/abc?x=1'])('shows a sign-in link back to %s', async (path) => {
    signedOutAt(path);
    const link = await screen.findByRole('link', { name: 'Sign in with Google' });
    expect(link.getAttribute('href')).toBe(`/auth/google?next=${encodeURIComponent(path)}`);
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
