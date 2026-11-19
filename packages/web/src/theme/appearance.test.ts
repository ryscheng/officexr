import { describe, expect, it } from 'vitest';
import { createAppearanceController, resolveAppearance, storedAppearance } from './appearance';

function fakes(prefersDark = false, stored: string | null = null) {
  const data = new Map<string, string>(stored ? [['officexr:appearance', stored]] : []);
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  const listeners = new Set<() => void>();
  const media = {
    matches: prefersDark,
    addEventListener: (_: string, cb: () => void) => void listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => void listeners.delete(cb),
  };
  const root = { dataset: {} as DOMStringMap };
  const systemTurns = (dark: boolean) => {
    media.matches = dark;
    listeners.forEach((cb) => cb());
  };
  return { storage, media: media as unknown as MediaQueryList, root, data, systemTurns };
}

describe('appearance', () => {
  it('defaults to light and ignores junk in storage', () => {
    expect(storedAppearance(fakes().storage)).toBe('light');
    expect(storedAppearance(fakes(false, 'purple').storage)).toBe('light');
    expect(storedAppearance(fakes(false, 'dark').storage)).toBe('dark');
  });

  it('resolves auto from the system', () => {
    expect(resolveAppearance('auto', true)).toBe('dark');
    expect(resolveAppearance('auto', false)).toBe('light');
    expect(resolveAppearance('dark', false)).toBe('dark');
  });

  it('applies the stored choice at once, then remembers and applies a new one', () => {
    const f = fakes(false, 'dark');
    const c = createAppearanceController(f);
    expect(f.root.dataset.theme).toBe('dark');
    c.set('light');
    expect(f.root.dataset.theme).toBe('light');
    expect(f.data.get('officexr:appearance')).toBe('light');
  });

  it('follows the system only on auto', () => {
    const f = fakes(false);
    const c = createAppearanceController(f);
    f.systemTurns(true);
    expect(f.root.dataset.theme).toBe('light');
    c.set('auto');
    expect(f.root.dataset.theme).toBe('dark');
    f.systemTurns(false);
    expect(f.root.dataset.theme).toBe('light');
  });

  it('tells subscribers about a change', () => {
    const c = createAppearanceController(fakes());
    let calls = 0;
    c.subscribe(() => calls++);
    c.set('dark');
    expect(calls).toBe(1);
    expect(c.get()).toBe('dark');
  });
});
