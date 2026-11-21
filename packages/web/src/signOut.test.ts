// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signOut } from './signOut';

afterEach(() => vi.unstubAllGlobals());

describe('signOut', () => {
  it('posts the logout and reloads at the root', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response)));
    await signOut();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/auth/logout', { credentials: 'include', method: 'POST' });
    expect(assign).toHaveBeenCalledWith('/');
  });

  it('throws the server message and stays put when it fails', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'Logout broke' }) } as Response)));
    await expect(signOut()).rejects.toThrow('Logout broke');
    expect(assign).not.toHaveBeenCalled();
  });
});
