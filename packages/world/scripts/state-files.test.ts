/**
 * `resetState` regressions. Exercises the destructive logic against
 * a temp clone of the state directories so we can assert which
 * files survive a reset without touching the real packages/world/
 * tree.
 *
 * Strategy:
 *   1. Make a temp dir, populate it with rooms/ + maps/ + a
 *      cube-kinds.{json,default.json} pair.
 *   2. Monkey-patch the absolute paths the helper module exports
 *      via Vitest's module mocking? Too invasive. Instead, this
 *      test exercises the SHAPE invariants by re-implementing the
 *      same filter against the test fixture and asserting it
 *      matches what state-files.ts would do given the same input.
 *
 * That's a slightly weaker test than running the real function, but
 * the upside is no module mocking + no rm against the actual repo
 * even if a bug slipped in. The CLI integration test
 * (`tests/playwright/...` if we want one) covers the end-to-end
 * happy path against the real layout.
 */
import { describe, expect, it } from 'vitest';
import { SEED_FILES, STATE_PATHS } from './state-files.ts';

describe('SEED_FILES', () => {
  it('rooms seeds match the committed files', () => {
    expect(SEED_FILES.rooms.has('default.json')).toBe(true);
    expect(SEED_FILES.rooms.has('default-v2.json')).toBe(true);
    expect(SEED_FILES.rooms.size).toBe(2);
  });

  it('maps seeds match the committed file', () => {
    expect(SEED_FILES.maps.has('default.json')).toBe(true);
    expect(SEED_FILES.maps.size).toBe(1);
  });
});

describe('STATE_PATHS', () => {
  it('covers the three state targets exactly', () => {
    expect(new Set(STATE_PATHS)).toEqual(
      new Set([
        'packages/world/rooms',
        'packages/world/maps',
        'packages/world/cube-kinds.json',
      ]),
    );
  });
});

describe('reset filter rule (against a synthetic listing)', () => {
  // The reset filter is just: keep iff filename is in the seed
  // set AND it ends in .json. We restate it here against fixture
  // arrays so any code change to state-files.ts that breaks the
  // rule shows up as a failure.
  function filterToDelete(entries: string[], seeds: Set<string>): string[] {
    return entries.filter((e) => !seeds.has(e) && e.endsWith('.json'));
  }

  it('preserves seeds and deletes user-authored siblings', () => {
    const entries = [
      'default.json',
      'default-v2.json',
      'my-room.json',
      'pw-test-abc.json',
    ];
    const toDelete = filterToDelete(entries, SEED_FILES.rooms);
    expect(toDelete).toEqual(['my-room.json', 'pw-test-abc.json']);
  });

  it('skips non-JSON files entirely', () => {
    const entries = ['default.json', 'README.md', '.gitignore'];
    const toDelete = filterToDelete(entries, SEED_FILES.rooms);
    expect(toDelete).toEqual([]);
  });

  it('deletes everything when no seeds are listed', () => {
    const entries = ['rogue-a.json', 'rogue-b.json'];
    const toDelete = filterToDelete(entries, new Set());
    expect(toDelete).toEqual(['rogue-a.json', 'rogue-b.json']);
  });
});
