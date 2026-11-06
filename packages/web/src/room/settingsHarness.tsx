import { fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SettingsProvider, type SettingsAction, type SettingsPane, type SettingsTab } from './Settings';
import { SettingsButton, SettingsModal } from './SettingsModal';

/** Test support: the gear and the modal over the given contributions. */
export function SettingsHarness({
  tabs = [],
  panes,
  actions = [],
  children,
}: {
  tabs?: SettingsTab[];
  panes?: SettingsPane[];
  actions?: SettingsAction[];
  children?: ReactNode;
}) {
  return (
    <SettingsProvider>
      <SettingsButton />
      <SettingsModal title="HQ" tabs={tabs} panes={panes} actions={actions} />
      {children}
    </SettingsProvider>
  );
}

export const openSettings = () => fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
