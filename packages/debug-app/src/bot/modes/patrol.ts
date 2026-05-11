import type { BotModeContext, BotModeStrategy } from './types.ts';

export const patrolStrategy: BotModeStrategy = {
  onEnter(ctx: BotModeContext) {
    // Force the next computeIntent to rebuild the waypoint loop from
    // the current map size — handy when the player resized the world
    // between mode toggles.
    ctx.modeState.patrolWaypoints = null;
  },
  computeIntent(ctx: BotModeContext): { x: number; z: number } | null {
    if (!ctx.modeState.patrolWaypoints) {
      // Inset square from the map's half-extent. Bot loops these.
      const half = (ctx.state.worldMap.gridSize * ctx.state.worldMap.cubeSize) / 2;
      const inset = Math.max(2, half * 0.6);
      ctx.modeState.patrolWaypoints = [
        { x: +inset, z: +inset },
        { x: +inset, z: -inset },
        { x: -inset, z: -inset },
        { x: -inset, z: +inset },
      ];
      ctx.modeState.patrolIdx = 0;
    }
    const waypoints = ctx.modeState.patrolWaypoints;
    const target = waypoints[ctx.modeState.patrolIdx]!;
    const dx = target.x - ctx.botPos.x;
    const dz = target.z - ctx.botPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.6) {
      ctx.modeState.patrolIdx =
        (ctx.modeState.patrolIdx + 1) % waypoints.length;
      // Recurse to the next leg in the same tick so the bot doesn't
      // stand still for a frame after reaching a waypoint.
      return this.computeIntent(ctx);
    }
    return { x: dx / dist, z: dz / dist };
  },
};
