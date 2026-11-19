import {
  CAR_RADIUS,
  collideCarWithCar,
  collideCarWithWorld,
  createCarBody,
  headingOf,
  integrateCar,
  speedOf,
  type CarBody,
  type CarInput,
} from './carPhysics.ts';
import { circleContacts, createCollisionWorld, type CollisionWorld } from './collision.ts';
import { formatClock, skyAt, wrapHour, type SkyState } from './dayNight.ts';
import { CAR_COLOURS, PARKING_OFFSET, rightOf, type CityLayout } from './generate.ts';
import { bumpHeat, coolHeat, createHeat, heatStars, type HeatMeter } from './heat.ts';
import { createPedestrians, stepPedestrian, type Pedestrian } from './pedestrians.ts';
import { createRng } from './rng.ts';
import {
  createTrafficAgent,
  signalColour,
  stepTrafficAgent,
  stunTrafficAgent,
  type TrafficAgent,
  type TrafficContext,
} from './traffic.ts';

export type CarControl = 'parked' | 'player' | 'traffic';

export interface SimCar {
  id: number;
  body: CarBody;
  color: string;
  control: CarControl;
  agent: TrafficAgent | null;
  steer: number;
  bumpedAt: number;
}

export interface PlayerState {
  x: number;
  z: number;
  yaw: number;
  carId: number | null;
  speed: number;
  stride: number;
}

export interface CityInput {
  moveX: number;
  moveZ: number;
  sprint: boolean;
  throttle: number;
  steer: number;
  handbrake: boolean;
  interact: boolean;
  cameraYaw: number;
}

export interface HudSnapshot {
  mode: 'foot' | 'car';
  speedKmh: number;
  stars: number;
  clock: string;
  night: boolean;
  prompt: string | null;
}

export interface SimulationOptions {
  startHour?: number;
  hoursPerSecond?: number;
  trafficCount?: number;
  pedestrianCount?: number;
}

export interface CitySimulation {
  city: CityLayout;
  world: CollisionWorld;
  cars: SimCar[];
  peds: Pedestrian[];
  player: PlayerState;
  heat: HeatMeter;
  time: number;
  hours: number;
  hoursPerSecond: number;
  step(dt: number, input: CityInput): void;
  enterableCar(): SimCar | null;
  playerCar(): SimCar | null;
  sky(): SkyState;
  hud(): HudSnapshot;
}

export const NO_INPUT: CityInput = {
  moveX: 0,
  moveZ: 0,
  sprint: false,
  throttle: 0,
  steer: 0,
  handbrake: false,
  interact: false,
  cameraYaw: 0,
};

const FIXED_DT = 1 / 60;
const MAX_SUBSTEPS = 6;
const WALK_SPEED = 4.6;
const SPRINT_SPEED = 8;
const FOOT_RADIUS = 0.4;
const ENTER_RANGE = 3.6;
const EXIT_MAX_SPEED = 6;
const STEER_RATE = 5;

export function createCitySimulation(city: CityLayout, options: SimulationOptions = {}): CitySimulation {
  const { startHour = 17.4, hoursPerSecond = 1 / 30, trafficCount = 16, pedestrianCount = 30 } = options;
  const rng = createRng(city.seed ^ 0x9e3779b9);
  const world = createCollisionWorld(city.obstacles, city.bounds);

  const coast = city.blocksZ;
  const mid = Math.floor(city.blocksX / 2);
  const startX = city.xRoads[mid]!;
  const startZ = city.zRoads[coast]!;
  const starter = { x: startX + 24, z: startZ - PARKING_OFFSET, yaw: -Math.PI / 2, color: '#ff6b57' };

  const cars: SimCar[] = [];
  const addCar = (x: number, z: number, yaw: number, color: string, control: CarControl): SimCar => {
    const car: SimCar = {
      id: cars.length,
      body: createCarBody(x, z, yaw),
      color,
      control,
      agent: null,
      steer: 0,
      bumpedAt: -10,
    };
    cars.push(car);
    return car;
  };
  addCar(starter.x, starter.z, starter.yaw, starter.color, 'parked');
  for (const p of city.parkedCars) {
    if (Math.hypot(p.x - starter.x, p.z - starter.z) > 6) addCar(p.x, p.z, p.yaw, p.color, 'parked');
  }
  for (let n = 0; n < trafficCount; n++) {
    const car = addCar(0, 0, 0, rng.pick(CAR_COLOURS), 'traffic');
    car.agent = createTrafficAgent(city, rng, car.id);
  }

  const player: PlayerState = { x: startX + 22, z: startZ - 8.8, yaw: 0, carId: null, speed: 0, stride: 0 };
  const heat = createHeat();
  const peds = createPedestrians(city, rng, pedestrianCount);

  const sim: CitySimulation = {
    city,
    world,
    cars,
    peds,
    player,
    heat,
    time: 0,
    hours: startHour,
    hoursPerSecond,
    step(dt, input) {
      const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.round(dt / FIXED_DT)));
      for (let n = 0; n < steps; n++) {
        tick(dt / steps, n === 0 && input.interact ? input : { ...input, interact: false });
      }
    },
    enterableCar,
    playerCar: () => (player.carId === null ? null : cars[player.carId]!),
    sky: () => skyAt(sim.hours),
    hud() {
      const car = sim.playerCar();
      const speed = car ? speedOf(car.body) : 0;
      const stillEnough = speed < EXIT_MAX_SPEED;
      return {
        mode: car ? 'car' : 'foot',
        speedKmh: Math.round(speed * 3.6),
        stars: heatStars(heat),
        clock: formatClock(sim.hours),
        night: sim.sky().night > 0.5,
        prompt: car ? (stillEnough ? 'F  Get out' : null) : enterableCar() ? 'F  Get in' : null,
      };
    },
  };

  function enterableCar(): SimCar | null {
    if (player.carId !== null) return null;
    let best: SimCar | null = null;
    let bestDist = ENTER_RANGE;
    for (const car of cars) {
      if (car.control !== 'parked') continue;
      const d = Math.hypot(car.body.x - player.x, car.body.z - player.z);
      if (d < bestDist) {
        best = car;
        bestDist = d;
      }
    }
    return best;
  }

  const footBlocked = (x: number, z: number): boolean => {
    if (circleContacts(world, x, z, FOOT_RADIUS).length > 0) return true;
    return cars.some((c) => c.control !== 'player' && Math.hypot(c.body.x - x, c.body.z - z) < 1.9);
  };

  function exitCar(car: SimCar) {
    const [hx, hz] = headingOf(car.body.yaw);
    const [rx, rz] = rightOf(hx, hz);
    const spots: [number, number][] = [
      [-rx * 2.2, -rz * 2.2],
      [rx * 2.2, rz * 2.2],
      [-hx * 3.4, -hz * 3.4],
      [hx * 3.4, hz * 3.4],
    ];
    const spot = spots.find(([dx, dz]) => !footBlocked(car.body.x + dx, car.body.z + dz)) ?? spots[0]!;
    player.x = car.body.x + spot[0];
    player.z = car.body.z + spot[1];
    player.yaw = car.body.yaw;
    player.carId = null;
    car.control = 'parked';
    car.body.vx = 0;
    car.body.vz = 0;
    car.body.yawRate = 0;
  }

  function bump(car: SimCar | null, other: SimCar, impact: number) {
    if (impact < 2 || sim.time - other.bumpedAt < 0.8) return;
    other.bumpedAt = sim.time;
    if (other.control === 'traffic') {
      bumpHeat(heat, Math.min(1.2, 0.35 + impact * 0.05));
      if (other.agent) stunTrafficAgent(other.agent);
    } else if (car) {
      bumpHeat(heat, Math.min(0.4, 0.1 + impact * 0.02));
    }
  }

  const trafficContext: TrafficContext = {
    get time() {
      return sim.time;
    },
    signal: (ni, nj, axis) => signalColour(sim.time, { i: ni, j: nj }, axis),
    gapAhead(agent, pose) {
      const hx = Math.sin(pose.yaw);
      const hz = Math.cos(pose.yaw);
      let gap = Infinity;
      const consider = (x: number, z: number) => {
        const dx = x - pose.x;
        const dz = z - pose.z;
        const fwd = dx * hx + dz * hz;
        const lat = Math.abs(dx * hz - dz * hx);
        if (fwd > 0 && fwd < 30 && lat < 2.2) gap = Math.min(gap, fwd);
      };
      for (const c of cars) if (c.id !== agent.carId) consider(c.body.x, c.body.z);
      if (player.carId === null) consider(player.x, player.z);
      return gap;
    },
  };

  const playerThreat = (x: number, z: number): boolean => {
    const car = sim.playerCar();
    if (!car) return false;
    const speed = speedOf(car.body);
    if (speed < 5) return false;
    const dx = x - car.body.x;
    const dz = z - car.body.z;
    const dist = Math.hypot(dx, dz);
    return dist < 9 && (dx * car.body.vx + dz * car.body.vz) / (dist * speed + 1e-6) > 0.3;
  };

  function stepOnFoot(dt: number, input: CityInput) {
    const fx = Math.sin(input.cameraYaw);
    const fz = Math.cos(input.cameraYaw);
    const [rx, rz] = rightOf(fx, fz);
    let vx = fx * input.moveZ + rx * input.moveX;
    let vz = fz * input.moveZ + rz * input.moveX;
    const mag = Math.hypot(vx, vz);
    if (mag > 1) {
      vx /= mag;
      vz /= mag;
    }
    const speed = (input.sprint ? SPRINT_SPEED : WALK_SPEED) * Math.min(1, mag);
    const target = mag > 0.01 ? Math.atan2(vx, vz) : player.yaw;
    let delta = target - player.yaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    player.yaw += delta * Math.min(1, 12 * dt);
    const nx = player.x + (mag > 0 ? (vx / Math.max(mag, 1e-6)) * speed * dt : 0);
    const nz = player.z + (mag > 0 ? (vz / Math.max(mag, 1e-6)) * speed * dt : 0);
    player.x = nx;
    player.z = nz;
    for (let pass = 0; pass < 2; pass++) {
      for (const hit of circleContacts(world, player.x, player.z, FOOT_RADIUS)) {
        player.x += hit.nx * hit.depth;
        player.z += hit.nz * hit.depth;
      }
      for (const c of cars) {
        if (c.control === 'player') continue;
        const dx = player.x - c.body.x;
        const dz = player.z - c.body.z;
        const dist = Math.hypot(dx, dz);
        const min = 1.0 + FOOT_RADIUS;
        if (dist < min && dist > 1e-6) {
          player.x += (dx / dist) * (min - dist);
          player.z += (dz / dist) * (min - dist);
        }
      }
    }
    player.speed = speed;
    player.stride += speed * dt;
  }

  function stepDriving(car: SimCar, dt: number, input: CityInput) {
    const carInput: CarInput = { throttle: input.throttle, steer: car.steer, handbrake: input.handbrake };
    car.steer += (input.steer - car.steer) * Math.min(1, STEER_RATE * dt);
    integrateCar(car.body, carInput, dt);
    const wall = collideCarWithWorld(car.body, world);
    if (wall && wall.speed > 12) bumpHeat(heat, 0.05);
    for (const other of cars) {
      if (other === car) continue;
      if (Math.hypot(other.body.x - car.body.x, other.body.z - car.body.z) > CAR_RADIUS * 5) continue;
      const hit = collideCarWithCar(car.body, other.body);
      if (hit) bump(car, other, hit.speed);
    }
    player.x = car.body.x;
    player.z = car.body.z;
    player.yaw = car.body.yaw;
    player.speed = speedOf(car.body);
  }

  function tick(dt: number, input: CityInput) {
    sim.time += dt;
    sim.hours = wrapHour(sim.hours + dt * sim.hoursPerSecond);

    const driven = sim.playerCar();
    if (input.interact) {
      if (driven) {
        if (speedOf(driven.body) < EXIT_MAX_SPEED) exitCar(driven);
      } else {
        const car = enterableCar();
        if (car) {
          car.control = 'player';
          player.carId = car.id;
        }
      }
    }

    const current = sim.playerCar();
    if (current) stepDriving(current, dt, input);
    else stepOnFoot(dt, input);

    for (const car of cars) {
      if (car.control !== 'traffic' || !car.agent) continue;
      const pose = stepTrafficAgent(city, car.agent, trafficContext, rng, dt);
      car.body.x = pose.x;
      car.body.z = pose.z;
      car.body.yaw = pose.yaw;
      const [hx, hz] = headingOf(pose.yaw);
      car.body.vx = hx * car.agent.speed;
      car.body.vz = hz * car.agent.speed;
    }

    const pedContext = { rng, threatNear: playerThreat };
    for (const ped of peds) stepPedestrian(city, ped, pedContext, dt);
    coolHeat(heat, dt);
  }

  return sim;
}
