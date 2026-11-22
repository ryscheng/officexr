export type HintStorage = Pick<Storage, 'length' | 'key' | 'removeItem'>;
export type HintFlagStorage = HintStorage & Pick<Storage, 'getItem' | 'setItem'>;

export const HINT_FLAG_PREFIX = 'officexr:hint:';
export const HINT_MAX_SHOWS = 2;

export type HintName = 'move' | 'people' | 'alone' | 'build';

const DONE = 'done';

// What this page load has shown or finished, so a blocked store still limits a hint to once per session.
const shownThisSession = new Set<HintName>();
const doneThisSession = new Set<HintName>();

export function resetHintSession(): void {
  shownThisSession.clear();
  doneThisSession.clear();
}

const keyOf = (name: HintName) => `${HINT_FLAG_PREFIX}${name}`;

function browserStorage(): HintFlagStorage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function hintShowCount(name: HintName, storage: HintFlagStorage | null = browserStorage()): number {
  try {
    const raw = storage?.getItem(keyOf(name)) ?? null;
    if (raw === DONE) {
      return HINT_MAX_SHOWS;
    }
    const count = Number(raw);
    return Number.isInteger(count) && count > 0 ? Math.min(count, HINT_MAX_SHOWS) : 0;
  } catch {
    return 0;
  }
}

export function isHintAvailable(name: HintName, storage?: HintFlagStorage | null): boolean {
  return !shownThisSession.has(name) && !doneThisSession.has(name) && hintShowCount(name, storage) < HINT_MAX_SHOWS;
}

export function recordHintShown(name: HintName, storage: HintFlagStorage | null = browserStorage()): void {
  shownThisSession.add(name);
  try {
    storage?.setItem(keyOf(name), String(hintShowCount(name, storage) + 1));
  } catch {
    // The session set above still stops a second showing.
  }
}

export function markHintDone(name: HintName, storage: HintFlagStorage | null = browserStorage()): void {
  doneThisSession.add(name);
  try {
    storage?.setItem(keyOf(name), DONE);
  } catch {
    // The session set above still stops a second showing.
  }
}

export function clearHintFlags(storage?: HintStorage): void {
  resetHintSession();
  try {
    const store = storage ?? localStorage;
    const keys = Array.from({ length: store.length }, (_, i) => store.key(i)).filter((k): k is string => k?.startsWith(HINT_FLAG_PREFIX) === true);
    keys.forEach((k) => store.removeItem(k));
  } catch {
    // Storage is blocked, so no hint was remembered either.
  }
}
