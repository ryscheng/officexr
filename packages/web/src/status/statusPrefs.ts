import { STATUS_EMOJI_MAX, STATUS_TEXT_MAX } from '@officexr/sdk';

export type StatusPrefs = { text: string; emoji: string; focus: boolean };

export const DEFAULT_STATUS_PREFS: StatusPrefs = { text: '', emoji: '', focus: false };

const STORAGE_KEY = 'officexr:status';

type PrefsStorage = Pick<Storage, 'getItem' | 'setItem'>;

const clean = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export function readStatusPrefs(storage: Pick<Storage, 'getItem'>): StatusPrefs {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null') as Partial<Record<keyof StatusPrefs, unknown>> | null;
    return {
      text: clean(parsed?.text, STATUS_TEXT_MAX),
      emoji: clean(parsed?.emoji, STATUS_EMOJI_MAX),
      focus: parsed?.focus === true,
    };
  } catch {
    return DEFAULT_STATUS_PREFS;
  }
}

export function writeStatusPrefs(storage: PrefsStorage, prefs: StatusPrefs): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Unremembered choice: the next load starts with no status.
  }
}
