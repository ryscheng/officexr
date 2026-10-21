import type { MapStorage } from '@officexr/world/scenes';

export const DEFAULT_MAP = 'default';

type LoadableMaps = Pick<MapStorage, 'load'>;

/** Serves the default map in place of any other map that doesn't exist. */
export function withDefaultMap(maps: LoadableMaps): LoadableMaps {
  return {
    async load(name) {
      const map = await maps.load(name);
      if (map || name === DEFAULT_MAP) {
        return map;
      }
      console.warn(`Map "${name}" not found; loading "${DEFAULT_MAP}" instead`);
      return maps.load(DEFAULT_MAP);
    },
  };
}
