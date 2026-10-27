import type { BotModeStrategy, BotModeContext } from './types.ts';

/**
 * Pure intent source: returns a fixed unit XZ direction every tick.
 *
 * SRP: this strategy's sole job is to produce a direction vector. It knows
 * nothing about speed, Rapier, gravity, or respawn — those all live in
 * CharacterMovement (task-03). BotDriver.tick() maps this direction to
 * `this.movement.walk(dir, currentYaw, dtSec)`.
 *
 * OCP: adding new configurable walk directions requires no changes to this
 * file or BotDriver — only modeState.linearWalkDir is read, which is set
 * externally via BotDriver.setModeWithConfig or the __OFFICE_BOTS__ window hook.
 */
export const linearWalkStrategy: BotModeStrategy = {
  onEnter(ctx: BotModeContext): void {
    // linearWalkDir is set by BotDriver.setModeWithConfig before onEnter fires.
    // If not set (e.g. mode was set via setMode() without config), default to +Z.
    if (!ctx.modeState.linearWalkDir) {
      ctx.modeState.linearWalkDir = { x: 0, z: 1 };
    }
  },

  computeIntent(ctx: BotModeContext): { x: number; z: number } {
    const dir = ctx.modeState.linearWalkDir ?? { x: 0, z: 1 };
    // Normalize defensively: BotCharacterMovement also normalizes, but being
    // explicit here makes the intent contract clear and unit-testable.
    const len = Math.hypot(dir.x, dir.z);
    if (len < 1e-6) return { x: 0, z: 1 };
    return { x: dir.x / len, z: dir.z / len };
  },
};
