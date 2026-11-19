import { circleContacts, type CollisionWorld } from './collision.ts';
import { rightOf } from './generate.ts';

export interface CarBody {
  x: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  yawRate: number;
}

export interface CarInput {
  throttle: number;
  steer: number;
  handbrake: boolean;
}

export interface CarParams {
  maxSpeed: number;
  reverseMax: number;
  accel: number;
  reverseAccel: number;
  brakeDecel: number;
  rolling: number;
  drag: number;
  wheelbase: number;
  maxSteer: number;
  minSteer: number;
  grip: number;
  handbrakeGrip: number;
}

export const CAR_PARAMS: CarParams = {
  maxSpeed: 38,
  reverseMax: 9,
  accel: 17,
  reverseAccel: 8,
  brakeDecel: 32,
  rolling: 1.2,
  drag: 0.02,
  wheelbase: 2.7,
  maxSteer: 0.62,
  minSteer: 0.1,
  grip: 9,
  handbrakeGrip: 1.1,
};

export const CAR_RADIUS = 1.05;
export const CAR_CIRCLE_OFFSETS = [-1.35, 0, 1.35] as const;
const RESTITUTION = 0.25;

export const headingOf = (yaw: number): [number, number] => [Math.sin(yaw), Math.cos(yaw)];

export function createCarBody(x: number, z: number, yaw: number): CarBody {
  return { x, z, yaw, vx: 0, vz: 0, yawRate: 0 };
}

export function forwardSpeed(car: CarBody): number {
  const [hx, hz] = headingOf(car.yaw);
  return car.vx * hx + car.vz * hz;
}

export function speedOf(car: CarBody): number {
  return Math.hypot(car.vx, car.vz);
}

/** Positive `steer` turns right; `yaw` grows when the car turns left. */
export function integrateCar(car: CarBody, input: CarInput, dt: number, p: CarParams = CAR_PARAMS): void {
  const [hx, hz] = headingOf(car.yaw);
  const [rx, rz] = rightOf(hx, hz);
  let vf = car.vx * hx + car.vz * hz;
  let vl = car.vx * rx + car.vz * rz;

  if (input.throttle > 0) {
    vf +=
      vf < -0.5
        ? p.brakeDecel * dt
        : p.accel * input.throttle * Math.max(0, 1 - Math.max(vf, 0) / p.maxSpeed) * dt;
  } else if (input.throttle < 0) {
    vf -=
      vf > 0.5
        ? p.brakeDecel * -input.throttle * dt
        : p.reverseAccel * -input.throttle * Math.max(0, 1 - Math.max(-vf, 0) / p.reverseMax) * dt;
  } else {
    const loss = Math.min(Math.abs(vf), (p.rolling + p.drag * Math.abs(vf) * Math.abs(vf)) * dt);
    vf -= Math.sign(vf) * loss;
  }
  if (input.handbrake) {
    vf -= Math.sign(vf) * Math.min(Math.abs(vf), 7 * dt);
  }

  const grip = input.handbrake ? p.handbrakeGrip : p.grip;
  vl *= Math.exp(-grip * dt);

  const speedT = Math.min(Math.abs(vf) / 35, 1);
  const steerAngle = -input.steer * (p.maxSteer + (p.minSteer - p.maxSteer) * speedT);
  const slideGain = input.handbrake && Math.abs(vf) > 5 ? 1.7 : 1;
  const target = ((vf * Math.tan(steerAngle)) / p.wheelbase) * slideGain;
  car.yawRate += (target - car.yawRate) * Math.min(1, 10 * dt);
  car.yaw += car.yawRate * dt;

  const [nhx, nhz] = headingOf(car.yaw);
  const [nrx, nrz] = rightOf(nhx, nhz);
  car.vx = nhx * vf + nrx * vl;
  car.vz = nhz * vf + nrz * vl;
  car.x += car.vx * dt;
  car.z += car.vz * dt;
}

export interface Impact {
  speed: number;
}

export function carCircles(car: Pick<CarBody, 'x' | 'z' | 'yaw'>): [number, number][] {
  const [hx, hz] = headingOf(car.yaw);
  return CAR_CIRCLE_OFFSETS.map((o) => [car.x + hx * o, car.z + hz * o]);
}

/** Pushes the car out of walls and obstacles and bounces its velocity; returns the hardest hit. */
export function collideCarWithWorld(car: CarBody, world: CollisionWorld): Impact | null {
  let hardest = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (const [cx, cz] of carCircles(car)) {
      for (const hit of circleContacts(world, cx, cz, CAR_RADIUS)) {
        car.x += hit.nx * hit.depth;
        car.z += hit.nz * hit.depth;
        const vn = car.vx * hit.nx + car.vz * hit.nz;
        if (vn < 0) {
          car.vx -= (1 + RESTITUTION) * vn * hit.nx;
          car.vz -= (1 + RESTITUTION) * vn * hit.nz;
          car.yawRate *= 0.7;
          hardest = Math.max(hardest, -vn);
        }
      }
    }
  }
  return hardest > 0.5 ? { speed: hardest } : null;
}

/** Treats `other` as immovable: pushes `car` away and bounces its velocity. */
export function collideCarWithCar(car: CarBody, other: Pick<CarBody, 'x' | 'z' | 'yaw'>): Impact | null {
  let hardest = 0;
  const otherCircles = carCircles(other);
  const minDist = CAR_RADIUS * 2 * 0.92;
  for (const [cx, cz] of carCircles(car)) {
    for (const [ox, oz] of otherCircles) {
      const dx = cx - ox;
      const dz = cz - oz;
      const dist = Math.hypot(dx, dz);
      if (dist >= minDist || dist < 1e-6) continue;
      const nx = dx / dist;
      const nz = dz / dist;
      const depth = minDist - dist;
      car.x += nx * depth;
      car.z += nz * depth;
      const vn = car.vx * nx + car.vz * nz;
      if (vn < 0) {
        car.vx -= (1 + RESTITUTION) * vn * nx;
        car.vz -= (1 + RESTITUTION) * vn * nz;
        hardest = Math.max(hardest, -vn);
      }
    }
  }
  return hardest > 0.5 ? { speed: hardest } : null;
}
