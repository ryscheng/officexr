/**
 * Tests the routing-decision logic from `Header.tsx` + `StudioPage.tsx`
 * — the parts that decide which mode app to mount. We don't render
 * the actual React tree (the studio package's vitest env is node-only
 * and adding jsdom + RTL for one shallow render is heavier than it's
 * worth). The mount step is trivial JSX branching; the
 * worth-testing-from-the-outside logic is:
 *
 *   1. `isStudioMode` accepts every declared mode and rejects others.
 *   2. The hash → mode resolver returns the right mode for valid
 *      hashes and falls back when the hash is missing, empty, or
 *      bogus.
 *   3. Tab change → `replaceState` writes the corresponding hash.
 *
 * Items (2) and (3) are exercised against a minimal mock `window` so
 * the test runs in node without a real DOM.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STUDIO_MODES,
  isStudioMode,
  type StudioMode,
} from '../ui/Header.tsx';

describe('isStudioMode', () => {
  it('accepts every declared mode in STUDIO_MODES', () => {
    for (const m of STUDIO_MODES) {
      expect(isStudioMode(m.mode)).toBe(true);
    }
  });

  it('rejects unknown strings, non-strings, null, undefined', () => {
    expect(isStudioMode('bogus')).toBe(false);
    expect(isStudioMode('')).toBe(false);
    expect(isStudioMode('ROOM')).toBe(false);
    expect(isStudioMode(null)).toBe(false);
    expect(isStudioMode(undefined)).toBe(false);
    expect(isStudioMode(0)).toBe(false);
    expect(isStudioMode({ mode: 'room' })).toBe(false);
  });

  it('STUDIO_MODES covers all five expected modes', () => {
    const modes = STUDIO_MODES.map((m) => m.mode).sort();
    expect(modes).toEqual(['character', 'debug', 'map', 'object', 'room']);
  });
});

/**
 * Behavior under test: the resolver used by `StudioPage` to translate
 * `location.hash` into an initial mode. Mirrors `readHashMode` in
 * `StudioPage.tsx`. We re-declare the small helper here rather than
 * exporting it from `StudioPage.tsx` (which would force a React
 * import in the test runner) — but the test asserts the same
 * predicate + slice + fallback contract.
 */
function readHashMode(hash: string): StudioMode | null {
  const fromHash = hash.replace(/^#/, '');
  return isStudioMode(fromHash) ? fromHash : null;
}

describe('hash → mode resolution', () => {
  it('returns the matching mode for each valid hash', () => {
    expect(readHashMode('#map')).toBe('map');
    expect(readHashMode('#room')).toBe('room');
    expect(readHashMode('#object')).toBe('object');
    expect(readHashMode('#character')).toBe('character');
    expect(readHashMode('#debug')).toBe('debug');
  });

  it('returns null when the hash is missing / empty / bogus', () => {
    expect(readHashMode('')).toBeNull();
    expect(readHashMode('#')).toBeNull();
    expect(readHashMode('#bogus')).toBeNull();
    expect(readHashMode('#ROOM')).toBeNull(); // case-sensitive on purpose
  });

  it('strips a single leading # before matching', () => {
    expect(readHashMode('room')).toBe('room'); // tolerant of a passed-through hash
  });
});

/**
 * Behavior under test: mode → hash write. `StudioPage`'s effect calls
 * `history.replaceState(null, '', '#<mode>')` whenever the active mode
 * changes. We mock the history API and run the side-effect that the
 * useEffect body performs.
 */
describe('mode → hash write', () => {
  type ReplaceStateFn = (
    state: unknown,
    unused: string,
    url?: string | URL | null,
  ) => void;
  let replaceSpy: ReturnType<typeof vi.fn>;
  let win: { location: { hash: string }; history: { replaceState: ReplaceStateFn } };

  beforeEach(() => {
    replaceSpy = vi.fn();
    win = {
      location: { hash: '' },
      history: { replaceState: replaceSpy as unknown as ReplaceStateFn },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Inline copy of the effect body from StudioPage.tsx so the test
  // exercises the same conditional write semantics (idempotent on a
  // no-op, writes when the hash differs).
  function writeHashForMode(mode: StudioMode): void {
    const next = `#${mode}`;
    if (win.location.hash !== next) {
      win.history.replaceState(null, '', next);
      win.location.hash = next; // simulate the browser updating after replaceState
    }
  }

  it('writes the hash on a first mode change', () => {
    writeHashForMode('room');
    expect(replaceSpy).toHaveBeenCalledWith(null, '', '#room');
    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });

  it('does not re-write when the hash already matches', () => {
    win.location.hash = '#room';
    writeHashForMode('room');
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('writes again when the mode changes to a different value', () => {
    writeHashForMode('room');
    writeHashForMode('debug');
    expect(replaceSpy).toHaveBeenCalledTimes(2);
    expect(replaceSpy).toHaveBeenLastCalledWith(null, '', '#debug');
  });
});
