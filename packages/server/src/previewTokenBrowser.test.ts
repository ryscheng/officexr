import { afterEach, describe, expect, it, vi } from 'vitest';
import { capturePreviewToken, clearPreviewToken, previewToken } from './previewTokenBrowser';

const NOW = Date.UTC(2026, 0, 1);
const b64url = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (exp: number) => `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'a@example.com', exp })}.sig`;
const valid = jwt(NOW / 1000 + 600);

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

function page(href: string) {
  const url = new URL(href);
  const replaceState = vi.fn();
  return { loc: url as unknown as Location, hist: { state: { s: 1 }, replaceState } as unknown as History, replaceState };
}

afterEach(() => {
  clearPreviewToken(null);
});

describe('capturePreviewToken', () => {
  it('stores the token and strips only it from the URL', () => {
    const storage = memoryStorage();
    const { loc, hist, replaceState } = page(`https://x.officexr-5zb.pages.dev/room/1?a=b#keep=1&officexr_token=${valid}`);
    capturePreviewToken(loc, hist, storage);
    expect(previewToken(storage, NOW)).toBe(valid);
    expect(replaceState).toHaveBeenCalledWith({ s: 1 }, '', '/room/1?a=b#keep=1');
  });

  it('leaves the URL alone without a token', () => {
    const storage = memoryStorage();
    const { loc, hist, replaceState } = page('https://x.officexr-5zb.pages.dev/#section');
    capturePreviewToken(loc, hist, storage);
    expect(replaceState).not.toHaveBeenCalled();
    expect(previewToken(storage, NOW)).toBeNull();
  });

  it('keeps the token in memory when storage refuses writes', () => {
    const refusing = { ...memoryStorage(), setItem: () => { throw new Error('quota'); } };
    const { loc, hist } = page(`https://x.officexr-5zb.pages.dev/#officexr_token=${valid}`);
    capturePreviewToken(loc, hist, refusing);
    expect(previewToken(refusing, NOW)).toBe(valid);
  });
});

describe('previewToken', () => {
  it.each([['expired', jwt(NOW / 1000)], ['unreadable', 'not-a-jwt']])('drops an %s token', (_kind, token) => {
    const storage = memoryStorage();
    storage.setItem('officexr.previewToken', token);
    expect(previewToken(storage, NOW)).toBeNull();
    expect(storage.getItem('officexr.previewToken')).toBeNull();
  });
});
