import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FilesystemLayoutStorage,
  FilesystemMapStorage,
  FilesystemRoomStorage,
  LocalStorageLayoutStorage,
  LocalStorageMapStorage,
  LocalStorageRoomStorage,
} from '@officexr/world/scenes';
import type { PlayStorages } from '@officexr/world/react';

const LAST_MAP_KEY = 'officexr:studio:lastMap';

export interface MapPickerState {
  /** All map names served by `/api/maps`, sorted alphabetically. */
  maps: readonly string[];
  /** The map currently selected by the dropdown. */
  selected: string;
  /** Bumped by `reset`; pass to `<PlayView reloadKey>` to re-apply the map. */
  resetCount: number;
  storages: PlayStorages;
  choose: (name: string) => void;
  reset: () => void;
  /** Re-fetch the list from /api/maps. */
  reloadList: () => void;
}

/**
 * Headless state for the Debug-mode Map picker: which map is selected,
 * remembered in localStorage across reloads. `<PlayView>` does the loading.
 */
export function useMapPicker(): MapPickerState {
  const storages = useMemo<PlayStorages>(() => {
    try {
      return {
        maps: new FilesystemMapStorage(),
        rooms: new FilesystemRoomStorage(),
        layouts: new FilesystemLayoutStorage(),
      };
    } catch {
      return {
        maps: new LocalStorageMapStorage(),
        rooms: new LocalStorageRoomStorage(),
        layouts: new LocalStorageLayoutStorage(),
      };
    }
  }, []);

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
      const list = await storages.maps.list();
      const names = list.map((m) => m.name).sort();
      // Always keep the selected name visible even if storage doesn't
      // know about it yet (just-created map).
      if (!names.includes(selected)) names.push(selected);
      setMaps(names);
    } catch (err) {
      console.warn('[map-picker] list failed:', err);
      setMaps([selected]);
    }
  }, [storages, selected]);

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

  return { maps, selected, resetCount, storages, choose, reset, reloadList };
}
