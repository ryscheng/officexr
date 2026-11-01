import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

async function load(studioOrigin: string | undefined, meStatus: number | 'network error' = 200) {
  vi.resetModules();
  vi.stubEnv('VITE_STUDIO_API_ORIGIN', studioOrigin as string);
  vi.stubEnv('VITE_API_ORIGIN', 'https://web.example');
  const fetchMock = vi.fn(async () => {
    if (meStatus === 'network error') {
      throw new TypeError('Failed to fetch');
    }
    return new Response('{}', { status: meStatus });
  });
  vi.stubGlobal('fetch', fetchMock);
  const { SignInGate } = await import('./SignInGate.tsx');
  return { SignInGate, fetchMock };
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('SignInGate', () => {
  it('renders the studio without asking when the studio API origin is unset', async () => {
    const { SignInGate, fetchMock } = await load(undefined);
    render(<SignInGate bypass={false}>studio</SignInGate>);
    expect(screen.getByText('studio')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders the studio without asking in test mode', async () => {
    const { SignInGate, fetchMock } = await load('https://studio.example', 401);
    render(<SignInGate bypass>studio</SignInGate>);
    expect(screen.getByText('studio')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders the studio once /api/me accepts the session', async () => {
    const { SignInGate, fetchMock } = await load('https://studio.example', 200);
    render(<SignInGate bypass={false}>studio</SignInGate>);
    expect(await screen.findByText('studio')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('https://studio.example/api/me', { credentials: 'include' });
  });

  it('links a signed-out user to web sign-in, returning here without login_error', async () => {
    window.history.replaceState(null, '', '/studio/?login_error=x&mode=map#frag');
    const { SignInGate } = await load('https://studio.example', 401);
    render(<SignInGate bypass={false}>studio</SignInGate>);
    const link = await screen.findByRole('link', { name: 'Sign in with Google' });
    const next = `${window.location.origin}/studio/?mode=map#frag`;
    expect(link.getAttribute('href')).toBe(`https://web.example/auth/google?next=${encodeURIComponent(next)}`);
    expect(screen.queryByText('studio')).toBeNull();
  });

  it('tells a signed-in user without studio access they are not allowed', async () => {
    const { SignInGate } = await load('https://studio.example', 403);
    render(<SignInGate bypass={false}>studio</SignInGate>);
    expect(await screen.findByText("Your account isn't allowed to use the studio")).toBeTruthy();
    expect(screen.queryByText('studio')).toBeNull();
  });

  it.each([500, 'network error' as const])('reports an unreachable studio server on %s', async (outcome) => {
    const { SignInGate } = await load('https://studio.example', outcome);
    render(<SignInGate bypass={false}>studio</SignInGate>);
    expect(await screen.findByText("Couldn't reach the studio server")).toBeTruthy();
    expect(screen.queryByText('studio')).toBeNull();
  });
});
