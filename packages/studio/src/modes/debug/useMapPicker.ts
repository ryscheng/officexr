import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MapStorage } from '@officexr/world/scenes';

const LAST_MAP_KEY = 'officexr:studio:lastMap';

export interface MapPickerState {
  /** All map names served by `/api/maps`, sorted alphabetically. */
  maps: readonly string[];
  /** The map currently selected by the dropdown. */
  selected: string;
  /** Bumped by `reset`; pass to `<PlayView reloadKey>` to re-apply the map. */
  resetCount: number;
  choose: (name: string) => void;
  reset: () => void;
  /** Re-fetch the list from /api/maps. */
  reloadList: () => void;
}

/**
 * Headless state for the Debug-mode Map picker: which map is selected,
 * remembered in localStorage across reloads. `<PlayView>` does the loading.
 */
export function useMapPicker(mapStorage: MapStorage): MapPickerState {

  const initialName = useMemo(() => {
    try {
      return globalThis.localStorage?.getItem(LAST_MAP_KEY) ?? 'default';
    } catch {
      return 'default';
    }
  }, []);

  const [maps, setMaps] = useState<string[]>([initialName]);
  const [selected, setSelected] = useState<string>(initialName);
  const [resetCount, setResetCount] = useState(0);

  const reloadList = useCallback(async () => {
    try {
      const list = await mapStorage.list();
      const names = list.map((m) => m.name).sort();
      // Always keep the selected name visible even if storage doesn't
      // know about it yet (just-created map).
      if (!names.includes(selected)) names.push(selected);
      setMaps(names);
    } catch (err) {
      console.warn('[map-picker] list failed:', err);
      setMaps([selected]);
    }
  }, [mapStorage, selected]);

  useEffect(() => {
    void reloadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = useCallback((name: string) => {
    setSelected(name);
    try {
      globalThis.localStorage?.setItem(LAST_MAP_KEY, name);
    } catch {
      // ignore.
    }
  }, []);

  const reset = useCallback(() => setResetCount((n) => n + 1), []);

  return { maps, selected, resetCount, choose, reset, reloadList };
}
