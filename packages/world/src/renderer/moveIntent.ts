/** Analog walking intent: `x` is strafe (right +), `z` is forward (+), within the unit circle. */
export type MoveInput = { x: number; z: number };

export const NO_MOVE: Readonly<MoveInput> = Object.freeze({ x: 0, z: 0 });

/** Deflection at or above this runs, like holding Shift. */
export const RUN_DEFLECTION = 0.9;

export interface MoveIntent {
  /** Forward +, in [-1, 1]. */
  fwd: number;
  /** Right +, in [-1, 1]. */
  strafe: number;
  isRunning: boolean;
  /** Fraction of full speed: the stick's deflection, 1 for keys. */
  speedScale: number;
}

/** Merges held keys with an optional analog stick; keys win when any movement key is held. */
export function moveIntent(keys: ReadonlySet<string>, analog: MoveInput | undefined): MoveIntent {
  const keyFwd =
    (keys.has('w') || keys.has('arrowup') ? 1 : 0) -
    (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
  const keyStrafe =
    (keys.has('d') || keys.has('arrowright') ? 1 : 0) -
    (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  const stick = keyFwd === 0 && keyStrafe === 0 ? analog : undefined;
  const deflection = stick ? Math.hypot(stick.x, stick.z) : 0;
  return {
    fwd: stick ? stick.z : keyFwd,
    strafe: stick ? stick.x : keyStrafe,
    isRunning: keys.has('shift') || deflection >= RUN_DEFLECTION,
    speedScale: deflection > 0 ? deflection : 1,
  };
}
