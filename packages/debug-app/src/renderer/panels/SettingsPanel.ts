import { useControls, button } from 'leva';
import { exportLevaConfig, resetLevaConfig } from '../levaPersistence.ts';

/**
 * Leva "Settings" panel: export / reset buttons for the persisted Leva
 * config. Has no return value — the buttons trigger imperatively.
 */
export function useSettingsPanel(): void {
  useControls('Settings', {
    'Export JSON': button(() => exportLevaConfig()),
    'Reset to defaults': button(() => resetLevaConfig()),
  });
}
