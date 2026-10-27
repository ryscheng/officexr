import type {
  CharacterConfigs,
  WorldSettings,
} from '@officexr/sdk';
import { getCharacterConfig } from './registry.ts';

/**
 * The effective tunables for a single character after layering its
 * per-character config over the world-level defaults. All callers
 * (player input, bot AI, animation playback, collision sizing) read
 * through here so the precedence rule lives in exactly one place.
 *
 * Why a flat shape (instead of returning the merged settings + configs)?
 * — every consumer wants the resolved scalar; nobody downstream cares
 * which layer it came from. Keeping the merge here means call sites
 * stay terse: `const tun = resolveCharacterTunables(modelId, ws, ccs);
 * vel.x = tun.playerSpeed * dir.x;`
 */
export interface EffectiveTunables {
  /** World units per second — already includes per-character
   * `speedMultiplier` if any. Multiply by run multiplier separately
   * when the player holds Shift. */
  playerSpeed: number;
  /** Multiplier on `playerSpeed` when running. */
  runSpeedMultiplier: number;
  /** rad/s — smooth-turn cap. */
  turnSpeed: number;
  /** Collision sphere radius (world units). */
  charRadius: number;
  /** Bump-back animation duration (ms). */
  bumpEasingMs: number;
  /** AnimationAction.timeScale for the walk clip. */
  walkAnimSpeed: number;
  /** AnimationAction.timeScale for the run clip. */
  runAnimSpeed: number;
  /** AnimationAction.timeScale for the idle clip. */
  idleAnimSpeed: number;
}

/**
 * Resolve per-character tunables for a model id by layering its
 * `CharacterConfig` over the world's `WorldSettings`. Per-character
 * fields override; missing fields inherit. `speedMultiplier` is the
 * one multiplicative override — it scales `WorldSettings.playerSpeed`
 * rather than replacing it (intent: "this character is slightly
 * slower" reads more naturally than "this character moves at 2.4
 * m/s").
 *
 * Pure: same inputs → same output. Safe to call per-frame.
 */
export function resolveCharacterTunables(
  modelId: string,
  settings: WorldSettings,
  configs: CharacterConfigs,
): EffectiveTunables {
  const cfg = getCharacterConfig(configs, modelId);
  const speedMultiplier = cfg.speedMultiplier ?? 1;
  return {
    playerSpeed: settings.playerSpeed * speedMultiplier,
    runSpeedMultiplier: cfg.runSpeedMultiplier ?? settings.runSpeedMultiplier,
    turnSpeed: cfg.turnSpeed ?? settings.turnSpeed,
    charRadius: cfg.charRadius ?? settings.charRadius,
    bumpEasingMs: cfg.bumpEasingMs ?? settings.bumpEasingMs,
    walkAnimSpeed: cfg.walkAnimSpeed ?? settings.walkAnimSpeed,
    runAnimSpeed: cfg.runAnimSpeed ?? settings.runAnimSpeed,
    idleAnimSpeed: cfg.idleAnimSpeed ?? settings.idleAnimSpeed,
  };
}
