export const ZOMBIE_ROOM_HALF_SIZE = 13;
export const ZOMBIE_BASE_SPEED = 1.5;
export const ZOMBIE_SPEED_INCREMENT = 0.12; // added per wave
export const ZOMBIE_HIT_RADIUS = 0.9; // distance at which zombie damages player
export const ZOMBIE_DAMAGE_PER_SEC = 1;
export const ZOMBIE_MAX_HP = 2; // shots to kill a zombie
export const PLAYER_MAX_HP = 100;
export const WAVE_INTRO_MS = 3000;
export const GAME_OVER_DISPLAY_MS = 5000;

export function zombiesForWave(wave: number): number {
  return 2 + wave * 2; // wave 1 → 4, wave 2 → 6, wave 3 → 8 ...
}

export function zombieSpeedForWave(wave: number): number {
  return ZOMBIE_BASE_SPEED + (wave - 1) * ZOMBIE_SPEED_INCREMENT;
}

/** Deterministic spawn position for a zombie given wave + index. */
export function zombieSpawnPosition(
  wave: number,
  index: number,
  halfSize: number,
): { x: number; z: number } {
  const s1 = ((wave * 100 + index) * 9301 + 49297) % 233280;
  const s2 = (s1 * 4931 + 12345) % 233280;
  const r1 = s1 / 233280;
  const r2 = s2 / 233280;
  const edge = Math.floor(r1 * 4);
  const t = r2;
  const lo = -halfSize;
  const hi = halfSize;
  switch (edge) {
    case 0: return { x: lo + t * (hi - lo), z: lo };
    case 1: return { x: hi, z: lo + t * (hi - lo) };
    case 2: return { x: lo + t * (hi - lo), z: hi };
    default: return { x: lo, z: lo + t * (hi - lo) };
  }
}
