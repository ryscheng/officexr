import { describe, expect, it } from 'vitest';
import { DEFAULT_SFX_PREFS, parseSfxPrefs, readSfxPrefs, writeSfxPrefs } from './sfxPrefs';

describe('sfx prefs', () => {
  it('defaults to on at a moderate volume', () => {
    expect(parseSfxPrefs(null)).toEqual(DEFAULT_SFX_PREFS);
    expect(parseSfxPrefs('not json')).toEqual(DEFAULT_SFX_PREFS);
  });

  it('reads an off switch and clamps the volume', () => {
    expect(parseSfxPrefs('{"enabled":false,"volume":0.2}')).toEqual({ enabled: false, volume: 0.2 });
    expect(parseSfxPrefs('{"volume":7}').volume).toBe(1);
    expect(parseSfxPrefs('{"volume":-1}').volume).toBe(0);
    expect(parseSfxPrefs('{"volume":"loud"}').volume).toBe(DEFAULT_SFX_PREFS.volume);
  });

  it('round-trips through storage and survives a storage that throws', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    writeSfxPrefs(storage, { enabled: false, volume: 0.4 });
    expect(readSfxPrefs(storage)).toEqual({ enabled: false, volume: 0.4 });
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readSfxPrefs(broken)).toEqual(DEFAULT_SFX_PREFS);
    expect(() => writeSfxPrefs(broken, DEFAULT_SFX_PREFS)).not.toThrow();
  });
});
