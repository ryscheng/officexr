import { useState } from 'react';
import type { BotSettings } from './types.ts';

const DEFAULT_BOT_SETTINGS: BotSettings = { count: 1, mode: 'idle' };

export interface UseStudioSettingsResult {
  bot: BotSettings;
  setBot: (update: (prev: BotSettings) => BotSettings) => void;
}

/** Studio-local Debug-panel state that is not part of the world constants. */
export function useStudioSettings(): UseStudioSettingsResult {
  const [bot, setBot] = useState<BotSettings>(DEFAULT_BOT_SETTINGS);
  return { bot, setBot };
}
