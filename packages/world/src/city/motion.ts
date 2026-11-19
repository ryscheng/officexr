export type MotionState =
  | 'idle'
  | 'turn'
  | 'walk'
  | 'jog'
  | 'sprint'
  | 'crouch'
  | 'crouchWalk'
  | 'slide'
  | 'jumpStart'
  | 'air'
  | 'fall'
  | 'land'
  | 'roll'
  | 'vault'
  | 'climb'
  | 'swim'
  | 'toDoor'
  | 'getIn'
  | 'seated'
  | 'getOut';

export interface MotionBody {
  state: MotionState;
  t: number;
  entries: number;
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  vy: number;
  yaw: number;
  speed: number;
  peakY: number;
  landTime: number;
  scripted: boolean;
  fromX: number;
  fromZ: number;
  fromY: number;
  toX: number;
  toZ: number;
  toY: number;
  ledgeH: number;
  doorX: number;
  doorZ: number;
  doorYaw: number;
  carId: number | null;
}

export interface MotionIntent {
  moveX: number;
  moveZ: number;
  cameraYaw: number;
  sprint: boolean;
  crouch: boolean;
  walk: boolean;
  jump: boolean;
  interact: boolean;
}

export interface LedgeHit {
  h: number;
  dist: number;
  depth: number;
}

export interface Door {
  x: number;
  z: number;
  yaw: number;
  carId: number;
}

export interface MotionEnv {
  groundAt(x: number, z: number, y: number): number;
  waterDepth(x: number, z: number): number;
  ledgeAhead(x: number, z: number, dx: number, dz: number): LedgeHit | null;
  door(): Door | null;
  canExit(): boolean;
}

export type MotionEvent = { type: 'seated'; carId: number };

export interface MotionVisual {
  clip: string;
  loop: boolean;
  timeScale: number;
  fade: number;
  pitch: number;
  yOffset: number;
  visible: boolean;
}

export const NO_INTENT: MotionIntent = {
  moveX: 0,
  moveZ: 0,
  cameraYaw: 0,
  sprint: false,
  crouch: false,
  walk: false,
  jump: false,
  interact: false,
};

export const WATER_Y = -0.25;
export const GRAVITY = 18;
export const JUMP_SPEED = 6.4;
export const SPEEDS = { walk: 1.8, jog: 4.4, sprint: 7.6, crouchWalk: 2, swim: 2.6 } as const;
const SWIM_ENTER = 0.9;
const SWIM_EXIT = 0.55;
const TURN_START = 1.05;
const TURN_END = 0.1;
const TURN_RATE = 4.2;
const VAULT_MAX = 1.25;
const CLIMB_MAX = 2.5;
const VAULT_DURATION = 0.75;
const CLIMB_DURATION = 1.3;
const ROLL_DURATION = 0.8;
const SLIDE_DURATION = 0.9;
const TAKEOFF_DURATION = 0.16;
const HARD_FALL = 3.5;

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function createMotionBody(x: number, z: number, yaw: number): MotionBody {
  return {
    state: 'idle',
    t: 0,
    entries: 0,
    x,
    z,
    y: 0,
    vx: 0,
    vz: 0,
    vy: 0,
    yaw,
    speed: 0,
    peakY: 0,
    landTime: 0.35,
    scripted: false,
    fromX: 0,
    fromZ: 0,
    fromY: 0,
    toX: 0,
    toZ: 0,
    toY: 0,
    ledgeH: 0,
    doorX: 0,
    doorZ: 0,
    doorYaw: 0,
    carId: null,
  };
}

/** World-space move direction (unit or shorter, for analog input) and its length. */
export function desiredMove(i: MotionIntent): { dx: number; dz: number; mag: number } {
  const fx = Math.sin(i.cameraYaw);
  const fz = Math.cos(i.cameraYaw);
  let dx = fx * i.moveZ - fz * i.moveX;
  let dz = fz * i.moveZ + fx * i.moveX;
  const mag = Math.hypot(dx, dz);
  if (mag > 1) {
    dx /= mag;
    dz /= mag;
  }
  return { dx, dz, mag: Math.min(1, mag) };
}

type Emit = (event: MotionEvent) => void;

interface Strategy {
  clip: string;
  loop: boolean;
  fade: number;
  timeScale?: number;
  refSpeed?: number;
  fit?: number;
  pose?: (b: MotionBody) => { pitch?: number; yOffset?: number };
  hidden?: boolean;
  update(b: MotionBody, i: MotionIntent, env: MotionEnv, dt: number, emit: Emit): MotionState | null;
}

function locomotionState(i: MotionIntent): MotionState {
  const { mag } = desiredMove(i);
  const moving = mag > 0.1;
  if (i.crouch) return moving ? 'crouchWalk' : 'crouch';
  if (!moving) return 'idle';
  if (i.sprint && mag > 0.5) return 'sprint';
  if (i.walk || mag < 0.55) return 'walk';
  return 'jog';
}

function steerVelocity(b: MotionBody, i: MotionIntent, targetSpeed: number, accel: number, faceRate: number, dt: number) {
  const { dx, dz, mag } = desiredMove(i);
  const tx = dx * targetSpeed;
  const tz = dz * targetSpeed;
  const k = Math.min(1, accel * dt);
  b.vx += (tx - b.vx) * k;
  b.vz += (tz - b.vz) * k;
  b.speed = Math.hypot(b.vx, b.vz);
  if (mag > 0.1 && b.speed > 0.3) {
    b.yaw += wrapAngle(Math.atan2(b.vx, b.vz) - b.yaw) * Math.min(1, faceRate * dt);
  }
}

function settleOnGround(b: MotionBody, env: MotionEnv, dt: number): 'swim' | 'fall' | null {
  if (env.waterDepth(b.x, b.z) > SWIM_ENTER) return 'swim';
  const g = env.groundAt(b.x, b.z, b.y);
  if (b.y - g > 0.25) {
    b.vy = 0;
    b.peakY = b.y;
    return 'fall';
  }
  b.y += (g - b.y) * Math.min(1, 22 * dt);
  return null;
}

function beginLedge(b: MotionBody, i: MotionIntent, env: MotionEnv): MotionState | null {
  const { dx, dz, mag } = desiredMove(i);
  if (mag < 0.5 || b.speed < 1.2) return null;
  const hit = env.ledgeAhead(b.x, b.z, dx, dz);
  if (!hit) return null;
  const rise = hit.h - b.y;
  if (rise <= 0.3) return null;
  b.fromX = b.x;
  b.fromZ = b.z;
  b.fromY = b.y;
  b.ledgeH = hit.h;
  b.yaw = Math.atan2(dx, dz);
  if (rise <= VAULT_MAX && hit.depth <= 1.6 && b.speed > 2.5) {
    b.toX = b.x + dx * (hit.dist + hit.depth + 0.8);
    b.toZ = b.z + dz * (hit.dist + hit.depth + 0.8);
    b.toY = b.y;
    return 'vault';
  }
  if (rise <= CLIMB_MAX && i.jump) {
    b.toX = b.x + dx * (hit.dist + 0.55);
    b.toZ = b.z + dz * (hit.dist + 0.55);
    b.toY = hit.h;
    return 'climb';
  }
  return null;
}

function groundedUpdate(
  speedKey: 'walk' | 'jog' | 'sprint' | 'crouchWalk' | null,
  accel: number,
  faceRate: number,
): Strategy['update'] {
  return (b, i, env, dt) => {
    const away = settleOnGround(b, env, dt);
    if (away) return away;
    if (i.jump && b.state !== 'crouch' && b.state !== 'crouchWalk') return 'jumpStart';
    if (i.interact) {
      const door = env.door();
      if (door) {
        b.doorX = door.x;
        b.doorZ = door.z;
        b.doorYaw = door.yaw;
        b.carId = door.carId;
        return 'toDoor';
      }
    }
    if ((b.state === 'sprint' || b.state === 'jog') && i.crouch && b.speed > 5.2) return 'slide';
    const ledge = beginLedge(b, i, env);
    if (ledge) return ledge;
    const want = locomotionState(i);
    if (want !== b.state && !(b.state === 'turn' && want === 'idle')) return want;
    steerVelocity(b, i, speedKey ? SPEEDS[speedKey] : 0, accel, faceRate, dt);
    if (b.state === 'idle' && Math.abs(wrapAngle(i.cameraYaw - b.yaw)) > TURN_START) return 'turn';
    if (b.state === 'turn') {
      const diff = wrapAngle(i.cameraYaw - b.yaw);
      b.yaw += Math.sign(diff) * Math.min(Math.abs(diff), TURN_RATE * dt);
      if (Math.abs(diff) < TURN_END) return 'idle';
    }
    return null;
  };
}

function airUpdate(b: MotionBody, i: MotionIntent, env: MotionEnv, dt: number): MotionState | null {
  b.vy -= GRAVITY * dt;
  b.y += b.vy * dt;
  b.peakY = Math.max(b.peakY, b.y);
  const { dx, dz, mag } = desiredMove(i);
  const cap = Math.max(SPEEDS.jog, b.speed);
  const k = Math.min(1, 3 * dt);
  b.vx += (dx * cap * mag - b.vx) * k;
  b.vz += (dz * cap * mag - b.vz) * k;
  b.speed = Math.hypot(b.vx, b.vz);
  const g = env.groundAt(b.x, b.z, b.y);
  if (b.y <= g && b.vy <= 0) {
    b.y = g;
    const drop = b.peakY - g;
    b.vy = 0;
    if (env.waterDepth(b.x, b.z) > SWIM_ENTER) return 'swim';
    if (drop > HARD_FALL) {
      if (b.speed > 1.5 || desiredMove(i).mag > 0.2) {
        const { dx: rx, dz: rz } = desiredMove(i);
        if (desiredMove(i).mag > 0.2) b.yaw = Math.atan2(rx, rz);
        return 'roll';
      }
      b.landTime = 0.7;
      return 'land';
    }
    b.landTime = 0.35;
    return 'land';
  }
  if (b.state === 'air' && b.vy < -6) return 'fall';
  return null;
}

function scriptedPose(b: MotionBody, u: number, arc: number) {
  b.x = b.fromX + (b.toX - b.fromX) * u;
  b.z = b.fromZ + (b.toZ - b.fromZ) * u;
  b.y = b.fromY + (b.toY - b.fromY) * u + arc * Math.sin(Math.PI * u);
}

export const MOTION_STRATEGIES: Record<MotionState, Strategy> = {
  idle: { clip: 'Idle_A', loop: true, fade: 0.25, update: groundedUpdate(null, 10, 8) },
  turn: { clip: 'Walking_C', loop: true, fade: 0.15, timeScale: 0.7, update: groundedUpdate(null, 10, 8) },
  walk: { clip: 'Walking_C', loop: true, fade: 0.2, refSpeed: SPEEDS.walk, update: groundedUpdate('walk', 7, 9) },
  jog: { clip: 'Running_B', loop: true, fade: 0.2, refSpeed: SPEEDS.jog, update: groundedUpdate('jog', 6, 9) },
  sprint: { clip: 'Running_A', loop: true, fade: 0.2, refSpeed: 6.2, update: groundedUpdate('sprint', 4.5, 6) },
  crouch: { clip: 'Crouching', loop: true, fade: 0.2, update: groundedUpdate(null, 10, 8) },
  crouchWalk: { clip: 'Sneaking', loop: true, fade: 0.2, refSpeed: SPEEDS.crouchWalk, update: groundedUpdate('crouchWalk', 8, 8) },
  slide: {
    clip: 'Crouching',
    loop: true,
    fade: 0.1,
    pose: () => ({ pitch: -0.75, yOffset: 0.05 }),
    update(b, i, env, dt) {
      const away = settleOnGround(b, env, dt);
      if (away) return away;
      if (i.jump) return 'jumpStart';
      const u = clamp01(b.t / SLIDE_DURATION);
      const v = b.speed > 0 ? Math.max(1.2, b.fromY * (1 - u) ** 1.4 + 1.2) : 0;
      const h = Math.hypot(b.vx, b.vz) || 1;
      b.vx = (b.vx / h) * v;
      b.vz = (b.vz / h) * v;
      b.speed = v;
      if (u >= 1) return i.crouch ? 'crouch' : locomotionState(i);
      return null;
    },
  },
  jumpStart: {
    clip: 'Jump_Start',
    loop: false,
    fade: 0.1,
    fit: TAKEOFF_DURATION + 0.1,
    update(b, i, env, dt) {
      steerVelocity(b, i, Math.max(b.speed, 0), 3, 6, dt);
      if (b.t >= TAKEOFF_DURATION) {
        b.vy = JUMP_SPEED;
        b.peakY = b.y;
        return 'air';
      }
      return null;
    },
  },
  air: { clip: 'Jump_Idle', loop: true, fade: 0.1, update: airUpdate },
  fall: { clip: 'Jump_Idle', loop: true, fade: 0.15, timeScale: 1.4, update: airUpdate },
  land: {
    clip: 'Jump_Land',
    loop: false,
    fade: 0.08,
    update(b, i, env, dt) {
      const away = settleOnGround(b, env, dt);
      if (away) return away;
      b.vx *= Math.max(0, 1 - 6 * dt);
      b.vz *= Math.max(0, 1 - 6 * dt);
      b.speed = Math.hypot(b.vx, b.vz);
      const early = b.landTime < 0.5 && b.t > 0.18 && desiredMove(i).mag > 0.3;
      if (i.jump && b.landTime < 0.5) return 'jumpStart';
      return b.t >= b.landTime || early ? locomotionState(i) : null;
    },
  },
  roll: {
    clip: 'Dodge_Forward',
    loop: false,
    fade: 0.08,
    fit: ROLL_DURATION,
    update(b, i, env, dt) {
      const away = settleOnGround(b, env, dt);
      if (away) return away;
      const u = clamp01(b.t / ROLL_DURATION);
      const v = 5.5 * (1 - u * 0.65);
      b.vx = Math.sin(b.yaw) * v;
      b.vz = Math.cos(b.yaw) * v;
      b.speed = v;
      return u >= 1 ? locomotionState(i) : null;
    },
  },
  vault: {
    clip: 'Jump_Full_Short',
    loop: false,
    fade: 0.08,
    fit: VAULT_DURATION,
    pose: () => ({ pitch: 0.15 }),
    update(b, i) {
      b.scripted = true;
      const u = clamp01(b.t / VAULT_DURATION);
      scriptedPose(b, u, b.ledgeH - b.fromY + 0.1);
      b.speed = 4;
      b.vx = Math.sin(b.yaw) * 4;
      b.vz = Math.cos(b.yaw) * 4;
      if (u >= 1) {
        b.scripted = false;
        return locomotionState(i);
      }
      return null;
    },
  },
  climb: {
    clip: 'Jump_Idle',
    loop: true,
    fade: 0.1,
    timeScale: 0.6,
    pose: () => ({ pitch: 0.3 }),
    update(b) {
      b.scripted = true;
      const u = clamp01(b.t / CLIMB_DURATION);
      const rise = clamp01(u / 0.7);
      const slide = clamp01((u - 0.7) / 0.3);
      b.x = b.fromX + (b.toX - b.fromX) * slide * 0.9;
      b.z = b.fromZ + (b.toZ - b.fromZ) * slide * 0.9;
      b.y = b.fromY + (b.toY - b.fromY) * (rise * rise * (3 - 2 * rise));
      b.vx = 0;
      b.vz = 0;
      b.speed = 0;
      if (u >= 1) {
        b.scripted = false;
        b.x = b.toX;
        b.z = b.toZ;
        b.y = b.toY;
        return 'idle';
      }
      return null;
    },
  },
  swim: {
    clip: 'Crawling',
    loop: true,
    fade: 0.3,
    refSpeed: SPEEDS.swim,
    pose: () => ({ yOffset: WATER_Y - 0.1 }),
    update(b, i, env, dt) {
      if (env.waterDepth(b.x, b.z) < SWIM_EXIT) return locomotionState(i);
      b.y += (0 - b.y) * Math.min(1, 8 * dt);
      steerVelocity(b, i, SPEEDS.swim, 4, 5, dt);
      return null;
    },
  },
  toDoor: {
    clip: 'Walking_C',
    loop: true,
    fade: 0.2,
    refSpeed: SPEEDS.walk,
    update(b, _i, env, dt) {
      const dx = b.doorX - b.x;
      const dz = b.doorZ - b.z;
      const dist = Math.hypot(dx, dz);
      b.y += (env.groundAt(b.x, b.z, b.y) - b.y) * Math.min(1, 12 * dt);
      if (dist < 0.2 || b.t > 3.5) return 'getIn';
      const v = Math.min(2.6, dist * 4 + 0.6);
      b.vx = (dx / dist) * v;
      b.vz = (dz / dist) * v;
      b.speed = v;
      b.yaw += wrapAngle(Math.atan2(dx, dz) - b.yaw) * Math.min(1, 10 * dt);
      return null;
    },
  },
  getIn: {
    clip: 'Interact',
    loop: false,
    fade: 0.15,
    fit: 0.9,
    update(b, _i, _env, dt, emit) {
      b.vx = 0;
      b.vz = 0;
      b.speed = 0;
      b.yaw += wrapAngle(b.doorYaw - b.yaw) * Math.min(1, 10 * dt);
      if (b.t >= 0.9) {
        emit({ type: 'seated', carId: b.carId! });
        return 'seated';
      }
      return null;
    },
  },
  seated: {
    clip: 'Sit_Chair_Idle',
    loop: true,
    fade: 0.1,
    hidden: true,
    update(b) {
      b.vx = 0;
      b.vz = 0;
      return null;
    },
  },
  getOut: {
    clip: 'Interact',
    loop: false,
    fade: 0.1,
    fit: 0.8,
    update(b, i, env, dt) {
      b.vx = 0;
      b.vz = 0;
      b.speed = 0;
      b.y += (env.groundAt(b.x, b.z, b.y) - b.y) * Math.min(1, 12 * dt);
      return b.t >= 0.8 ? locomotionState(i) : null;
    },
  },
};

function enterState(b: MotionBody, next: MotionState) {
  const prev = b.state;
  b.state = next;
  b.t = 0;
  b.entries += 1;
  if (next === 'slide') b.fromY = Math.max(b.speed * 1.15, 6.2);
  if (next === 'getOut' || prev === 'seated') b.carId = null;
}

export function stepMotion(b: MotionBody, intent: MotionIntent, env: MotionEnv, dt: number, emit: Emit): void {
  b.t += dt;
  const next = MOTION_STRATEGIES[b.state].update(b, intent, env, dt, emit);
  if (next && next !== b.state) enterState(b, next);
}

export function forceMotionState(b: MotionBody, next: MotionState): void {
  enterState(b, next);
}

export function motionVisual(b: MotionBody): MotionVisual {
  const s = MOTION_STRATEGIES[b.state];
  const pose = s.pose?.(b) ?? {};
  const scale = s.refSpeed ? Math.min(1.6, Math.max(0.5, b.speed / s.refSpeed)) : (s.timeScale ?? 1);
  return {
    clip: s.clip,
    loop: s.loop,
    timeScale: scale,
    fade: s.fade,
    pitch: pose.pitch ?? 0,
    yOffset: pose.yOffset ?? 0,
    visible: !s.hidden,
  };
}

export function clipFit(state: MotionState): number | null {
  return MOTION_STRATEGIES[state].fit ?? null;
}
