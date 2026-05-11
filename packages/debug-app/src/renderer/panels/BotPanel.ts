import { useEffect } from 'react';
import { useControls, button } from 'leva';
import type { BotMode } from '../../bot/BotDriver.ts';

export interface BotPanelOptions {
  /** Called whenever the Leva count slider changes. Page-level handler
   * decides whether to apply the new value to the in-browser pool or
   * to promote to Supabase mode and forward to the Node CLI. */
  onBotCountChange: (count: number) => void;
  /** Called whenever a Leva mode button is pressed. Page-level handler
   * mirrors `onBotCountChange` so mode toggles propagate to whichever
   * pool (in-browser or CLI) is currently authoritative. */
  onBotModeChange: (mode: BotMode) => void;
}

export interface BotPanelValues {
  count: number;
}

/**
 * Leva "Bot" panel: count slider + one button per mode. The count
 * slider grows / shrinks the live BotPool; mode buttons fan out to
 * every bot and become the default for newly-spawned bots until
 * another mode is chosen.
 */
export function useBotPanel(opts: BotPanelOptions): BotPanelValues {
  const { onBotCountChange, onBotModeChange } = opts;
  const cfg = useControls('Bot', {
    count: {
      value: 1,
      min: 0,
      max: 10,
      step: 1,
      label: 'count',
    },
    Stay: button(() => onBotModeChange('idle')),
    'Walk to me': button(() => onBotModeChange('walk-to-local')),
    'Walk away': button(() => onBotModeChange('walk-away')),
    Wander: button(() => onBotModeChange('wander')),
    Patrol: button(() => onBotModeChange('patrol')),
    Orbit: button(() => onBotModeChange('orbit')),
  });

  useEffect(() => {
    onBotCountChange(cfg.count);
  }, [onBotCountChange, cfg.count]);

  return { count: cfg.count };
}
