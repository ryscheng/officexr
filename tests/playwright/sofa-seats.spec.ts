/**
 * Three players share one multi-seat couch, each on their own cushion. The
 * local player walks up and presses Sit, so the nearest-free-seat pick runs in
 * the real seating controller; two remote players are placed through the store.
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { waitForBotsHook, goToDebugWithMap, setBotCount } from './motion-helpers.ts';
import { waitForCanvasReady } from './helpers.ts';

const SHOTS_DIR = process.env.SOFA_SHOTS_DIR;
const COUCH_ID = 'sofa-e2e';
// The couch spans x 3..6 and z 3..4.6 once placed; the seats face +z.
const COUCH_VOXEL = (cube: number) => [3 / cube, 2 / cube, 3 / cube];
const MIDDLE_X = 4.5;
const SEAT_SPACING_M = 0.9;
const FRONT_Z = 4.6 + 0.4;

type StoreHandle = {
  getState: () => any;
  setState: (updater: (s: any) => unknown) => void;
};
// Defined in the page by the init script in the test; only used inside `page.evaluate`.
declare const store: () => StoreHandle;

async function selfSeat(page: Page) {
  return page.evaluate(() => {
    const s = store().getState();
    const self = s.players[s.selfId];
    return { seat: self.seat ?? null, pos: self.pos, yaw: self.yaw };
  });
}

async function standInFront(page: Page, x: number) {
  await page.evaluate(
    ({ x, z }) => {
      store().setState((s) => ({
        players: {
          ...s.players,
          [s.selfId]: { ...s.players[s.selfId], pos: { x, y: 1.5, z }, vel: { x: 0, y: 0, z: 0 }, seat: null },
        },
      }));
    },
    { x, z: FRONT_Z },
  );
  await page.waitForTimeout(800);
}

async function tapSit(page: Page) {
  await page.keyboard.down('e');
  await page.waitForTimeout(200);
  await page.keyboard.up('e');
}

test('three players sit on three seats of one couch', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    (window as unknown as { store: () => unknown }).store = () =>
      (window as unknown as { __OFFICE_STORE__: unknown }).__OFFICE_STORE__;
  });
  await goToDebugWithMap(page, 'scenario-collision');
  await waitForCanvasReady(page, 0, 30_000);
  await waitForBotsHook(page);
  await setBotCount(page, 0);
  await page.evaluate(
    ({ id, voxel }) => {
      const instance = { id, sourceCommandId: id, kindId: 'furniture_couch', position: voxel, yawDeg: 0 };
      store().setState((s) => ({
        worldObjects: { ...s.worldObjects, instances: [...s.worldObjects.instances, instance] },
      }));
    },
    {
      id: COUCH_ID,
      voxel: COUCH_VOXEL(await page.evaluate(() => store().getState().worldObjects.cubeSize)),
    },
  );

  await standInFront(page, MIDDLE_X);
  await tapSit(page);
  await expect.poll(async () => (await selfSeat(page)).seat).toBe(`${COUCH_ID}#1`);
  const middle = await selfSeat(page);


  const remote = (name: string, seat: string, dx: number) => ({
    name,
    seat,
    pos: { ...middle.pos, x: middle.pos.x + dx },
  });
  await page.evaluate(
    (remotes) => {
      store().setState((s) => {
        const template = s.players[s.selfId];
        const added = Object.fromEntries(
          remotes.map((r) => [
            r.name,
            { ...template, id: r.name, name: r.name, seat: r.seat, pos: r.pos, vel: { x: 0, y: 0, z: 0 }, yaw: template.yaw },
          ]),
        );
        return { players: { ...s.players, ...added } };
      });
    },
    [
      remote('Ana', COUCH_ID, -SEAT_SPACING_M),
      remote('Ben', `${COUCH_ID}#1`, 0),
    ],
  );
  await page.evaluate(
    (seatYaw) => {
      store().setState((s) => ({
        players: {
          ...s.players,
          Ana: { ...s.players.Ana, yaw: seatYaw },
          Ben: { ...s.players.Ben, yaw: seatYaw },
        },
      }));
    },
    middle.yaw,
  );

  await standInFront(page, MIDDLE_X);
  expect((await selfSeat(page)).seat).toBeNull();
  await tapSit(page);
  await expect.poll(async () => (await selfSeat(page)).seat).toBe(`${COUCH_ID}#2`);
  expect((await selfSeat(page)).pos.x).toBeCloseTo(middle.pos.x + SEAT_SPACING_M, 1);

  if (SHOTS_DIR) {
    await page.evaluate(() => {
      store().setState((s) => ({
        worldConstants: {
          ...s.worldConstants,
          fixedCamera: { ...s.worldConstants.fixedCamera, azimuthDeg: 180, pitchDeg: -40, minOnScreenFrac: 0.05, maxOnScreenFrac: 0.15 },
        },
      }));
    });
    await page.waitForTimeout(1500);
    mkdirSync(SHOTS_DIR, { recursive: true });
    await page.screenshot({ path: `${SHOTS_DIR}/couch-${testInfo.project.name}.png` });
  }
});
