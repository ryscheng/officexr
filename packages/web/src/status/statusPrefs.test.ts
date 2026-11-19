import { describe, expect, it } from 'vitest';
import { STATUS_EMOJI_MAX, STATUS_TEXT_MAX } from '@officexr/sdk';
import { DEFAULT_STATUS_PREFS, readStatusPrefs, writeStatusPrefs } from './statusPrefs';

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

const throwing = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('status prefs', () => {
  it('round-trips a status', () => {
    const storage = memory();
    writeStatusPrefs(storage, { text: 'Reviewing', emoji: '📝', focus: true });
    expect(readStatusPrefs(storage)).toEqual({ text: 'Reviewing', emoji: '📝', focus: true });
  });

  it('starts empty with nothing saved or with unreadable data', () => {
    const storage = memory();
    expect(readStatusPrefs(storage)).toEqual(DEFAULT_STATUS_PREFS);
    storage.setItem('officexr:status', '{not json');
    expect(readStatusPrefs(storage)).toEqual(DEFAULT_STATUS_PREFS);
  });

  it('caps stored text and emoji, and ignores values of the wrong type', () => {
    const storage = memory();
    storage.setItem(
      'officexr:status',
      JSON.stringify({ text: 'x'.repeat(500), emoji: 'e'.repeat(500), focus: 'yes' }),
    );
    const prefs = readStatusPrefs(storage);
    expect(prefs.text).toHaveLength(STATUS_TEXT_MAX);
    expect(prefs.emoji).toHaveLength(STATUS_EMOJI_MAX);
    expect(prefs.focus).toBe(false);
    storage.setItem('officexr:status', JSON.stringify({ text: 5, emoji: null }));
    expect(readStatusPrefs(storage)).toEqual(DEFAULT_STATUS_PREFS);
  });

  it('does not throw when storage is blocked', () => {
    expect(readStatusPrefs(throwing)).toEqual(DEFAULT_STATUS_PREFS);
    expect(() => writeStatusPrefs(throwing, { text: 'a', emoji: '', focus: false })).not.toThrow();
  });
});
