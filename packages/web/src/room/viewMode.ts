import type { ViewMode } from '@officexr/sdk';

const STORAGE_KEY = 'officexr:viewMode';

export function storedViewMode(storage: Pick<Storage, 'getItem'> = localStorage): ViewMode | null {
  try {
    const value = storage.getItem(STORAGE_KEY);
    return value === '2d' || value === '3d' ? value : null;
  } catch {
    return null;
  }
}

export function storeViewMode(mode: ViewMode, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, mode);
  } catch {
    // Unremembered choice: the reload opens the default view.
  }
}

/** The view the user last picked from the menu, else 3D. Nothing else ever chooses it. */
export function initialViewMode(storage: Pick<Storage, 'getItem'> = localStorage): ViewMode {
  return storedViewMode(storage) ?? '3d';
}
