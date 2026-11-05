import { describe, expect, it } from "vitest";
import type { FootprintRect, PlayerId, Store } from "@officexr/sdk";
import { yawFromDirection } from "../../renderer/lookControls.ts";
import { GhostController, type GhostKeys } from "../ghost-controller.ts";

type P = { pos: { x: number; y: number; z: number }; yaw: number };
const TUN = { playerSpeed: 2, charRadius: 0.5, proximityRadius: 3 };
const none: GhostKeys = {
  forward: false,
  back: false,
  left: false,
  right: false,
};

function setup(
  footprint: FootprintRect[] = [],
  at = { x: 0, z: 0 },
  worldObjects: unknown = { cubeSize: 2, instances: [] },
) {
  const last = { vel: { x: 0, y: 0, z: 0 } };
  const players: Record<string, P> = {
    me: { pos: { x: at.x, y: 1.5, z: at.z }, yaw: 0 },
  };
  const actions = {
    setSelfPosition(
      pos: P["pos"],
      vel: typeof last.vel,
      yaw: number,
      airborne: boolean,
    ) {
      expect(airborne).toBe(false);
      last.vel = vel;
      players.me = { pos, yaw };
    },
  };
  const store = {
    getState: () => ({ players, worldObjects }),
  } as unknown as Pick<Store, "getState">;
  const c = new GhostController(
    actions,
    store,
    "me" as PlayerId,
    footprint,
    () => TUN,
  );
  return { c, players, last };
}
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

describe("GhostController", () => {
  it("walks at speed; forward is -Z; diagonals are normalized", () => {
    const { c, players } = setup();
    c.setKeys({ ...none, forward: true });
    c.step(1);
    expect(players.me.pos.z).toBeCloseTo(-2);
    c.setKeys({ ...none, right: true, back: true });
    c.step(1);
    expect(dist(players.me.pos, { x: 0, z: -2 })).toBeCloseTo(2);
    expect(players.me.pos.y).toBe(1.5);
  });

  it("yaw matches yawFromDirection", () => {
    const { c, players } = setup();
    c.setKeys({ ...none, right: true });
    c.step(0.1);
    expect(players.me.yaw).toBe(yawFromDirection({ x: 1, z: 0 }));
  });

  it("slides around another player and never overlaps", () => {
    const { c, players } = setup([], { x: 0, z: 5 });
    players.other = { pos: { x: 0.2, y: 0, z: 0 }, yaw: 0 };
    c.setKeys({ ...none, forward: true });
    for (let i = 0; i < 100; i++) {
      c.step(0.05);
      expect(dist(players.me.pos, players.other.pos)).toBeGreaterThanOrEqual(
        1 - 1e-9,
      );
    }
    expect(players.me.pos.z).toBeLessThan(0);
  });

  it("is never shoved when overlapped", () => {
    const { c, players } = setup();
    players.other = { pos: { x: 0.3, y: 0, z: 0 }, yaw: 0 };
    c.step(0.1);
    expect(players.me.pos.x).toBe(0);
    c.setKeys({ ...none, right: true });
    c.step(0.1);
    expect(dist(players.me.pos, players.other.pos)).toBeGreaterThanOrEqual(
      0.3 - 1e-9,
    );
  });

  it("gets around a player it is heading straight at", () => {
    const { c, players } = setup([], { x: 0, z: 5 });
    players.other = { pos: { x: 0, y: 0, z: 0 }, yaw: 0 };
    c.setKeys({ ...none, forward: true });
    for (let i = 0; i < 200; i++) {
      c.step(0.05);
      expect(dist(players.me.pos, players.other.pos)).toBeGreaterThanOrEqual(
        1 - 1e-9,
      );
    }
    expect(players.me.pos.z).toBeLessThan(-1);
  });

  it("moves as asked, without being pushed out, when overlapped", () => {
    const { c, players } = setup();
    players.other = { pos: { x: 0.3, y: 0, z: 0 }, yaw: 0 };
    c.setKeys({ ...none, back: true });
    c.step(0.1);
    expect(players.me.pos.z).toBeCloseTo(0.2);
    expect(dist(players.me.pos, players.other.pos)).toBeLessThan(1);
    expect(dist(players.me.pos, players.other.pos)).toBeGreaterThanOrEqual(0.3);
  });

  it("refuses a move the footprint clamp would turn into an overlap", () => {
    const fp = [{ min: { x: 0, z: 0 }, max: { x: 10, z: 10 } }];
    const { c, players } = setup(fp, { x: 0.2, z: 5.5 });
    players.other = { pos: { x: 0.2, y: 0, z: 4.2 }, yaw: 0 };
    c.setKeys({ ...none, forward: true });
    for (let i = 0; i < 40; i++) {
      c.step(0.05);
      expect(dist(players.me.pos, players.other.pos)).toBeGreaterThanOrEqual(
        1 - 1e-9,
      );
      expect(players.me.pos.x).toBeGreaterThanOrEqual(0);
    }
  });

  it("does not report a huge velocity on a spawn snap", () => {
    const fp = [{ min: { x: 0, z: 0 }, max: { x: 10, z: 10 } }];
    const { c, players, last } = setup(fp, { x: -50, z: 5 });
    c.step(0.016);
    expect(players.me.pos.x).toBe(0);
    expect(last.vel).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("stays in the footprint and snaps in on spawn", () => {
    const fp = [{ min: { x: 0, z: 0 }, max: { x: 10, z: 10 } }];
    const { c, players } = setup(fp, { x: -5, z: 5 });
    c.step(0.016);
    expect(players.me.pos.x).toBe(0);
    c.setKeys({ ...none, left: true });
    c.step(1);
    expect(players.me.pos.x).toBe(0);
  });

  it("moveTo arrives and stops", () => {
    const { c, players } = setup();
    c.moveTo({ x: 3, z: 0 });
    for (let i = 0; i < 10; i++) {
      c.step(0.5);
    }
    expect(players.me.pos.x).toBeCloseTo(3);
    c.step(0.5);
    expect(players.me.pos.x).toBeCloseTo(3);
  });

  it("goTo follows a moving target and stops at proximity range", () => {
    const { c, players } = setup();
    players.other = { pos: { x: 10, y: 0, z: 0 }, yaw: 0 };
    c.goTo("other" as PlayerId);
    c.step(1);
    players.other.pos = { x: 10, y: 0, z: 10 };
    for (let i = 0; i < 20; i++) {
      c.step(1);
    }
    expect(dist(players.me.pos, players.other.pos)).toBeCloseTo(
      TUN.proximityRadius,
    );
  });

  it("key input cancels auto-moves", () => {
    const { c, players } = setup();
    c.moveTo({ x: 10, z: 0 });
    c.setKeys({ ...none, back: true });
    c.setKeys(none);
    c.step(1);
    expect(players.me.pos.x).toBe(0);
  });

  it("takes a bounded step on the head-on frame", () => {
    const { c, players } = setup([], { x: 0, z: 1.2 });
    players.other = { pos: { x: 0, y: 0, z: 0 }, yaw: 0 };
    c.setKeys({ ...none, forward: true });
    for (let i = 0; i < 30; i++) {
      const before = { ...players.me.pos };
      c.step(0.05);
      expect(dist(before, players.me.pos)).toBeLessThanOrEqual(
        TUN.playerSpeed * 0.05 + 1e-9,
      );
    }
  });

  it("ignores world objects on its path", () => {
    const walk = (worldObjects?: unknown) => {
      const { c, players } = setup([], { x: 0, z: 0 }, worldObjects);
      c.setKeys({ ...none, forward: true });
      c.step(1);
      return players.me.pos;
    };
    const wall = {
      cubeSize: 2,
      instances: [{ kind: "wall", x: 0, y: 0, z: -1 }],
    };
    expect(walk(wall)).toEqual(walk());
  });

  it("goTo never presses against its target when proximityRadius is small", () => {
    const { c, players } = setup();
    TUN.proximityRadius = 0.1;
    players.other = { pos: { x: 10, y: 0, z: 0 }, yaw: 0 };
    c.goTo("other" as PlayerId);
    for (let i = 0; i < 20; i++) {
      c.step(1);
    }
    TUN.proximityRadius = 3;
    expect(dist(players.me.pos, players.other.pos)).toBeCloseTo(1);
  });
});
