import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { closeToWorld } from './closeToWorld';

export interface SettingsTab {
  id: string;
  label: string;
  content: ReactNode;
}

export interface SettingsAction {
  id: string;
  render: (close: () => void) => ReactNode;
}

interface SettingsState {
  isOpen: boolean;
  /** `null` shows the first tab. */
  tab: string | null;
  pane: string | null;
}

export interface Settings extends SettingsState {
  open: (tab?: string) => void;
  openPane: (id: string) => void;
  /** Leaves the open pane, or closes Settings when none is open. */
  back: () => void;
  close: () => void;
}

const CLOSED: SettingsState = { isOpen: false, tab: null, pane: null };

const SettingsContext = createContext<Settings | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(CLOSED);
  const close = useMemo(() => closeToWorld(() => setState(CLOSED)), []);
  const settings = useMemo<Settings>(
    () => ({
      ...state,
      open: (tab) => setState({ isOpen: true, tab: tab ?? null, pane: null }),
      openPane: (pane) => setState((s) => ({ ...s, pane })),
      back: () => (state.pane ? setState((s) => ({ ...s, pane: null })) : close()),
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
