export type HintStorage = Pick<Storage, 'length' | 'key' | 'removeItem'>;

export const HINT_FLAG_PREFIX = 'officexr:hint:';

export function clearHintFlags(storage?: HintStorage): void {
  try {
    const store = storage ?? localStorage;
    const keys = Array.from({ length: store.length }, (_, i) => store.key(i)).filter((k): k is string => k?.startsWith(HINT_FLAG_PREFIX) === true);
    keys.forEach((k) => store.removeItem(k));
  } catch {
    // Storage is blocked, so no hint was remembered either.
  }
}
