export interface DeskScreenMarkerEntry {
  deskAreaId: string;
  monitorInstanceId: string;
  readonly on: boolean;
  readonly glow: number;
}

export interface DeskScreenMarker {
  readonly screens: DeskScreenMarkerEntry[];
}

type MarkerWindow = { __OFFICE_DESK_SCREENS__?: DeskScreenMarker };

const groups = new Map<string, DeskScreenMarkerEntry[]>();

export function publishDeskScreens(key: string, entries: DeskScreenMarkerEntry[] | null): void {
  const win = globalThis as unknown as MarkerWindow;
  if (entries && entries.length > 0) groups.set(key, entries);
  else groups.delete(key);
  if (groups.size === 0) {
    delete win.__OFFICE_DESK_SCREENS__;
    return;
  }
  win.__OFFICE_DESK_SCREENS__ = {
    get screens() {
      return [...groups.values()].flat();
    },
  };
}
