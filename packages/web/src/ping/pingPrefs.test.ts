import { describe, expect, it } from 'vitest';
import { DEFAULT_PING_PREFS, readPingPrefs, writePingPrefs, type PingPrefs } from './pingPrefs';

const memoryStorage = (initial?: string) => {
  const data = new Map<string, string>(initial === undefined ? [] : [['officexr:ping', initial]]);
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

describe('pingPrefs', () => {
  it('round-trips prefs', () => {
    const storage = memoryStorage();
    const prefs: PingPrefs = { sound: { type: 'library', name: 'bell.mp3' }, notify: true };
    writePingPrefs(storage, prefs);
    expect(readPingPrefs(storage)).toEqual(prefs);
  });

  it('defaults when nothing is stored', () => {
    expect(readPingPrefs(memoryStorage())).toEqual(DEFAULT_PING_PREFS);
  });

  it.each(['not json', '{"sound":{"type":"library"},"notify":"yes"}', '{"sound":{"type":"loud"}}', 'null'])(
    'defaults the invalid parts of %s',
    (raw) => {
      expect(readPingPrefs(memoryStorage(raw))).toEqual(DEFAULT_PING_PREFS);
    },
  );

  it('keeps a valid sound beside an invalid notify flag', () => {
    expect(readPingPrefs(memoryStorage('{"sound":{"type":"none"},"notify":1}'))).toEqual({
      sound: { type: 'none' },
      notify: false,
    });
  });

  it('survives storage that throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readPingPrefs(throwing)).toEqual(DEFAULT_PING_PREFS);
    expect(() => writePingPrefs(throwing, DEFAULT_PING_PREFS)).not.toThrow();
  });
});
