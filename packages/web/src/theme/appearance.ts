/** What the user picked in Settings → Appearance; `auto` follows the operating system, like macOS. */
export type Appearance = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'officexr:appearance';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export function storedAppearance(storage: Pick<Storage, 'getItem'> = localStorage): Appearance {
  try {
    const value = storage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' || value === 'auto' ? value : 'light';
  } catch {
    return 'light';
  }
}

/** The theme `appearance` resolves to right now. */
export function resolveAppearance(appearance: Appearance, prefersDark: boolean): 'light' | 'dark' {
  return appearance === 'auto' ? (prefersDark ? 'dark' : 'light') : appearance;
}

type Deps = {
  root: Pick<HTMLElement, 'dataset'>;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  media: Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>;
};

/**
 * The one owner of the page's theme: keeps `data-theme` on the root in step with the user's
 * choice (and, on `auto`, with the system), remembers the choice, and tells subscribers.
 */
export function createAppearanceController({ root, storage, media }: Deps) {
  let appearance = storedAppearance(storage);
  const listeners = new Set<() => void>();
  const apply = () => {
    root.dataset.theme = resolveAppearance(appearance, media.matches);
  };
  // Only `auto` cares, but listening always keeps one code path; apply() reads the choice.
  media.addEventListener('change', apply);
  apply();
  return {
    get: () => appearance,
    set(next: Appearance) {
      appearance = next;
      try {
        storage.setItem(STORAGE_KEY, next);
      } catch {
        // Unremembered choice: the next visit opens in light.
      }
      apply();
      listeners.forEach((cb) => cb());
    },
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    dispose: () => media.removeEventListener('change', apply),
  };
}

export type AppearanceController = ReturnType<typeof createAppearanceController>;

let controller: AppearanceController | null = null;

/** The page's controller, created on first use; `main.tsx` calls this before the first paint so there's no flash. */
export function appearanceController(): AppearanceController {
  controller ??= createAppearanceController({
    root: document.documentElement,
    storage: localStorage,
    media: window.matchMedia(DARK_QUERY),
  });
  return controller;
}
