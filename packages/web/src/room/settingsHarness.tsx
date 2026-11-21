import { Fragment, useState, type ReactNode } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { createStore } from '@officexr/sdk';
import { SettingsSheet } from '../hud/settings/SettingsSheet';
import { SETTINGS_PAGES, SettingsProvider, useSettings, type SettingsAction, type SettingsPageId } from './Settings';

/** Test support: a gear and the real settings sheet over the given page content and actions. */
function Sheet({ controls, actions, pages }: { controls?: ReactNode; actions: SettingsAction[]; pages?: Partial<Record<SettingsPageId, ReactNode>> }) {
  const settings = useSettings();
  const [store] = useState(() => createStore({ selfId: 'me#t0', officeId: 'o' }));
  const content = Object.fromEntries(SETTINGS_PAGES.map((id) => [id, pages?.[id] ?? <p>{id} page</p>])) as Record<SettingsPageId, ReactNode>;
  content.controls = (
    <>
      {controls}
      {actions.map((action) => (
        <Fragment key={action.id}>{action.render(settings.close)}</Fragment>
      ))}
    </>
  );
  return (
    <>
      <button type="button" onClick={() => settings.open()}>
        Settings
      </button>
      {settings.isOpen && (
        <SettingsSheet
          store={store}
          portrait={false}
          page={settings.page}
          pages={content}
          canBuild
          onPage={settings.openPage}
          onBack={settings.back}
          onClose={settings.close}
          onInvite={() => {}}
          onBuild={() => {}}
          onSwitchOffice={() => {}}
          onSignOut={() => Promise.resolve()}
        />
      )}
    </>
  );
}

export function SettingsHarness({ controls, actions = [], pages, children }: { controls?: ReactNode; actions?: SettingsAction[]; pages?: Partial<Record<SettingsPageId, ReactNode>>; children?: ReactNode }) {
  return (
    <SettingsProvider>
      <Sheet controls={controls} actions={actions} pages={pages} />
      {children}
    </SettingsProvider>
  );
}

export const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

export const openPage = (name: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));

export const openSettings = () => {
  openMenu();
  openPage('Controls');
};
