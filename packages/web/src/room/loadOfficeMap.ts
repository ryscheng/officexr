import { MapNotFoundError } from '@officexr/world/app';

export const DEFAULT_MAP = 'default';

/** Loads the office's map, falling back to the default map when it has none or it doesn't exist. */
export async function loadOfficeMap<T>(load: (name: string) => Promise<T>, mapName: string | null): Promise<T> {
  const name = mapName ?? DEFAULT_MAP;
  try {
    return await load(name);
  } catch (err) {
    if (!(err instanceof MapNotFoundError) || name === DEFAULT_MAP) {
      throw err;
    }
    console.warn(`Map "${name}" not found; loading "${DEFAULT_MAP}" instead`);
    return load(DEFAULT_MAP);
  }
}
