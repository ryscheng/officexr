// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSignInNext, readSignInNext, saveSignInNext } from './signInNext';

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('signInNext', () => {
  it('round-trips a path and clears it', () => {
    saveSignInNext('/room/a?x=1');
    expect(readSignInNext()).toBe('/room/a?x=1');
    clearSignInNext();
    expect(readSignInNext()).toBeNull();
  });

  it.each(['//evil.example', 'https://evil.example', '/\\evil.example'])('ignores %s', (value) => {
    sessionStorage.setItem('officexr:signInNext', value);
    expect(readSignInNext()).toBeNull();
  });

  it('does nothing when the store throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => saveSignInNext('/room/a')).not.toThrow();
    expect(readSignInNext()).toBeNull();
    expect(() => clearSignInNext()).not.toThrow();
  });
});
