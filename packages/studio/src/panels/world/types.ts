import { DEFAULT_WORLD_CONSTANTS, type WorldConstants } from '@officexr/sdk';
import type { BotMode } from '@officexr/world/bot';

export type { AuxLightType, JumpSettings } from '@officexr/sdk';

/**
 * Every Debug-panel value: the world's constants plus the studio-local
 * bot controls. The studio's `useStudioSettings` hook owns this in
 * React state (with localStorage persistence).
 */
export type ViewConfig = Omit<WorldConstants, 'schemaVersion'> & {
  bot: BotSettings;
};

export interface BotSettings {
  count: number;
  mode: BotMode;
}

const { schemaVersion: _schemaVersion, ...DEFAULT_CONSTANT_SECTIONS } = DEFAULT_WORLD_CONSTANTS;

export const DEFAULT_VIEW_CONFIG: ViewConfig = {
  ...structuredClone(DEFAULT_CONSTANT_SECTIONS),
  bot: {
    count: 1,
    mode: 'idle',
  },
};
