/**
 * Scenario: walking through a `prototype_wall_doorway`.
 *
 * The wall runs along X at z∈[6, 6.53] (yaw 0), plain walls either side of
 * the doorway, whose opening is x∈[5.2, 6.8] (1.6 m wide). Everything starts
 * on the near (z<6) side; the far side is z>6.53. Floor top is y=0.5, so a
 * settled body root rests at y=0.
 *
 * Runs locally only: the prototype pack isn't downloaded in CI. Bake first:
 *   pnpm --filter @officexr/world bake:layout scenario-doorway
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { waitForCanvasReady } from './helpers.ts';
import {
  goToDebugWithMap,
  parkLocalPlayer,
  respawnBots,
  setBotCount,
  setFixedCamera,
  waitForBotCondition,
  waitForBotsHook,
} from './motion-helpers.ts';

const BOT_ID = 'bot-001';
const SELF_ID = 'local-player';

/** 9 floor tiles + 2 plain walls + the doorway. */
const DOORWAY_INSTANCE_COUNT = 12;

const DOORWAY_CENTRE_X = 6;
const PLAIN_WALL_X = 2;
const NEAR_SIDE_Z = 2;
const SETTLED_BODY_Y = 0;

async function bootDoorwayScenario(page: Page): Promise<void> {
  await goToDebugWithMap(page, 'scenario-doorway');
  await waitForCanvasReady(page, 0, 30_000);
  await waitForBotsHook(page);
  await page.waitForFunction(
    (count: number) =>
      (
        window as unknown as {
          __OFFICE_STORE__?: { getState: () => { worldObjects: { instances: unknown[] } } };
        }
      ).__OFFICE_STORE__?.getState().worldObjects.instances.length === count,
    DOORWAY_INSTANCE_COUNT,
    { timeout: 30_000, polling: 200 },
  );
  // Settling on the floor proves the baked-layout colliders are live; the
  // instance count alone doesn't (the GLB loads independently).
  await waitForBotCondition(
    page,
    SELF_ID,
    (pos, vel) => Math.abs(pos.y) < 0.05 && Math.abs(vel.y) < 0.001,
    30_000,
  );
}

/** Walk one bot in +Z from `startX` on the near side. */
async function startBotWalkingNorth(page: Page, startX: number): Promise<void> {
  await setBotCount(page, 1);
  await page.evaluate(() => {
    const bots = (
      window as unknown as {
        __OFFICE_BOTS__: { setLinearWalkDir: (idx: number, dir: { x: number; z: number }) => void };
      }
    ).__OFFICE_BOTS__;
    bots.setLinearWalkDir(0, { x: 0, z: 1 });
  });
  // The map bootstrap teleports the player to the spawn, so park after the
  // map has loaded, clear of the bot's lane.
  await parkLocalPlayer(page, { x: 10, y: SETTLED_BODY_Y, z: NEAR_SIDE_Z });
  await respawnBots(page, [{ x: startX, y: 0.5, z: NEAR_SIDE_Z }]);
}

test('doorway: bot walking at the opening ends up on the far side', async ({ page }) => {
  test.setTimeout(90_000);
  await bootDoorwayScenario(page);
  await startBotWalkingNorth(page, DOORWAY_CENTRE_X);

  await waitForBotCondition(page, BOT_ID, (pos) => pos.z > 7, 20_000);
});

test('doorway: bot walking at the plain wall stays on the near side', async ({ page }) => {
  test.setTimeout(90_000);
  await bootDoorwayScenario(page);
  await startBotWalkingNorth(page, PLAIN_WALL_X);

  // Pressed against the wall (ball radius 0.4 m → z≈5.6) and stalled.
  await waitForBotCondition(
    page,
    BOT_ID,
    (pos, vel) => pos.z > 5.3 && Math.abs(vel.z) < 0.1,
    20_000,
  );
  const state = await page.evaluate((id: string) => {
    const w = window as unknown as {
      __OFFICE_STORE__: { getState: () => { players: Record<string, { pos: { z: number } }> } };
    };
    return w.__OFFICE_STORE__.getState().players[id].pos;
  }, BOT_ID);
  expect(state.z, 'bot is held on the near side of the wall').toBeLessThan(6);
});

test('doorway: local player holding W ends up on the far side', async ({ page }) => {
  test.setTimeout(90_000);
  await bootDoorwayScenario(page);
  await setFixedCamera(page, { azimuthDeg: 0, movementYawOffsetDeg: 0 });

  // Bots off, and wait for the bot's store entry to vanish so it can't
  // perch the player; then stand the player in front of the opening.
  await setBotCount(page, 0);
  await page.waitForFunction(
    () =>
      Object.keys(
        (
          window as unknown as {
            __OFFICE_STORE__: { getState: () => { players: Record<string, unknown> } };
          }
        ).__OFFICE_STORE__.getState().players,
      ).length === 1,
    null,
    { timeout: 10_000, polling: 100 },
  );
  await parkLocalPlayer(page, { x: DOORWAY_CENTRE_X, y: SETTLED_BODY_Y, z: NEAR_SIDE_Z });

  // Focus the world so SceneFrame accepts keydown.
  await page.locator('canvas').first().click({ position: { x: 200, y: 200 } });
  await page.keyboard.down('KeyW');
  try {
    await waitForBotCondition(page, SELF_ID, (pos) => pos.z > 7, 20_000);
  } finally {
    await page.keyboard.up('KeyW');
  }
});
