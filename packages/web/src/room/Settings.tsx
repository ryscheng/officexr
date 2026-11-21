import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { focusWorld } from '@officexr/world/top-down';

export const SETTINGS_PAGES = ['profile', 'controls', 'alerts', 'office', 'help'] as const;
export type SettingsPageId = (typeof SETTINGS_PAGES)[number];

export interface SettingsAction {
  id: string;
  render: (close: () => void) => ReactNode;
}

interface SettingsState {
  isOpen: boolean;
  /** `null` shows the top-level list. */
  page: SettingsPageId | null;
}

export interface Settings extends SettingsState {
  open: (page?: SettingsPageId) => void;
  openPage: (page: SettingsPageId) => void;
  /** Leaves the open page, or closes Settings when none is open. */
  back: () => void;
  close: () => void;
}

const CLOSED: SettingsState = { isOpen: false, page: null };

const SettingsContext = createContext<Settings | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(CLOSED);
  const isOpen = useRef(false);
  const close = useCallback(() => {
    if (!isOpen.current) {
      return;
    }
    isOpen.current = false;
    setState(CLOSED);
    focusWorld();
  }, []);
  const settings = useMemo<Settings>(
    () => ({
      ...state,
      open: (page) => {
        isOpen.current = true;
        setState({ isOpen: true, page: page ?? null });
      },
      openPage: (page) => setState((s) => ({ ...s, page })),
      back: () => (state.page ? setState((s) => ({ ...s, page: null })) : close()),
      close,
    }),
    [state, close],
  );
  return <SettingsContext.Provider value={settings}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Settings {
  const settings = useContext(SettingsContext);
  if (!settings) {
    throw new Error('useSettings needs a SettingsProvider');
  }
  return settings;
}
