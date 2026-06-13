/**
 * Scenario: Slope — LOCAL PLAYER walks up a trimesh ramp.
 *
 * Slope kinds collide as geometry-scanned TRIMESHES (the model's own
 * welded triangles, normalized to its AABB — `pnpm scan:colliders
 * --mode=trimesh`), not stepped boxes: the KCC's slope handling gives
 * smooth gliding ascent (validated by deterministic Rapier simulation
 * at every slope-angle config). This spec covers the full production
 * path: baked v2 extras → BakedLayoutColliders TrimeshCollider →
 * SceneFrame keyboard walk.
 *
 * Map `scenario-slope` mirrors scenario-stairs exactly, with
 * prototype_primitive_slope in place of the staircase: base platform
 * x[4,8] top y=2 → 45° ramp x[0,4] rising y 2→6 toward −X → landing
 * x[-4,0] top y=6. Spawn [6,2,2]. Settled body root = surface − 0.5.
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { waitForCanvasReady } from './helpers.ts';
import { goToDebugWithMap } from './motion-helpers.ts';

const SELF_ID = 'local-player';
const SLOPE_INSTANCE_COUNT = 9;
const SPAWN_SETTLED_BODY_Y = 1.5;

async function getSelf(
  page: Page,
): Promise<{ pos: { x: number; y: number; z: number } } | null> {
  return page.evaluate((selfId: string) => {
    const w = window as unknown as {
      __OFFICE_STORE__?: {
        getState: () => {
          players: Record<
            string,
            { pos: { x: number; y: number; z: number } } | undefined
          >;
        };
      };
    };
    const p = w.__OFFICE_STORE__?.getState().players[selfId];
    return p ? { pos: p.pos } : null;
  }, SELF_ID);
}

test('slope: local player walks up the trimesh ramp under keyboard input', async ({
  page,
}) => {
  test.setTimeout(120_000);

  // Azimuth 90° pins W to pure −X — same harness as the stairs walk.
  await page.addInitScript(() => {
    localStorage.setItem(
      'officexr:studio:view-config',
      JSON.stringify({
        fixedCamera: { azimuthDeg: 90, movementYawOffsetDeg: 0 },
      }),
    );
  });

  await goToDebugWithMap(page, 'scenario-slope');
  await waitForCanvasReady(page, 0, 30_000);

  await page.waitForFunction(
    ({ selfId, count }: { selfId: string; count: number }) => {
      const w = window as unknown as {
        __OFFICE_STORE__?: {
          getState: () => {
            players: Record<string, unknown>;
            worldObjects: { instances: unknown[] };
          };
        };
      };
      const s = w.__OFFICE_STORE__?.getState();
      return Boolean(
        s && s.players[selfId] && s.worldObjects.instances.length === count,
      );
    },
    { selfId: SELF_ID, count: SLOPE_INSTANCE_COUNT },
    { timeout: 30_000, polling: 200 },
  );

  // Bots off — player-only spec. Then wait for the bot's store entry
  // to actually vanish and re-drop the player: bot and player share
  // the spawn point, and the player can perch on a (frozen) bot ball
  // otherwise — same boot race as scenario-stairs-player.
  await page.evaluate(async () => {
    const bots = (
      window as unknown as {
        __OFFICE_BOTS__?: { setCount: (n: number) => Promise<void> };
      }
    ).__OFFICE_BOTS__;
    if (bots) await bots.setCount(0);
  });
  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __OFFICE_STORE__?: { getState: () => { players: Record<string, unknown> } };
      };
      const players = w.__OFFICE_STORE__?.getState().players;
      return players ? Object.keys(players).length === 1 : false;
    },
    null,
    { timeout: 10_000, polling: 100 },
  );
  await page.evaluate((selfId: string) => {
    const w = window as unknown as {
      __OFFICE_STORE__: { setState: (u: (s: unknown) => unknown) => void };
    };
    w.__OFFICE_STORE__.setState((s: unknown) => {
      const state = s as {
        players: Record<string, { pos: unknown; vel: unknown } | undefined>;
      };
      const self = state.players[selfId];
      if (!self) return {};
      return {
        players: {
          ...state.players,
          [selfId]: {
            ...self,
            pos: { x: 6, y: 3, z: 2 },
            vel: { x: 0, y: 0, z: 0 },
          },
        },
      };
    });
  }, SELF_ID);

  // Settling on the spawn platform proves the baked v2 colliders are live.
  await page.waitForFunction(
    ({ selfId, y }: { selfId: string; y: number }) => {
      const w = window as unknown as {
        __OFFICE_STORE__?: {
          getState: () => {
            players: Record<
              string,
              { pos: { y: number }; vel: { y: number } } | undefined
            >;
          };
        };
      };
      const p = w.__OFFICE_STORE__?.getState().players[selfId];
      return Boolean(p && Math.abs(p.pos.y - y) < 0.1 && Math.abs(p.vel.y) < 0.001);
    },
    { selfId: SELF_ID, y: SPAWN_SETTLED_BODY_Y },
    { timeout: 15_000, polling: 100 },
  );

  await page.locator('canvas').first().click({ position: { x: 200, y: 200 } });
  await page.keyboard.down('KeyW');

  const trace: Array<{ x: number; y: number }> = [];
  let maxY = -Infinity;
  let reachedTop = false;
  try {
    const deadline = Date.now() + 30_000;
    let prev: { x: number; y: number } | null = null;
    while (Date.now() < deadline) {
      await page.waitForTimeout(250);
      const self = await getSelf(page);
      if (!self) continue;
      const cur = { x: self.pos.x, y: self.pos.y };
      trace.push(cur);
      if (prev && cur.x > prev.x + 1.5) {
        throw new Error(
          `player reset mid-climb (x ${prev.x.toFixed(2)} → ${cur.x.toFixed(2)}). ` +
            `trace: ${JSON.stringify(trace.map((t) => ({ x: +t.x.toFixed(2), y: +t.y.toFixed(2) })))}`,
        );
      }
      // A ramp ascent is SMOOTH — even less height give-back than
      // stairs. Same 0.15 m jitter budget.
      if (cur.y < maxY - 0.15) {
        throw new Error(
          `player lost height mid-climb (maxY ${maxY.toFixed(2)} → ${cur.y.toFixed(2)}). ` +
            `trace: ${JSON.stringify(trace.map((t) => ({ x: +t.x.toFixed(2), y: +t.y.toFixed(2) })))}`,
        );
      }
      maxY = Math.max(maxY, cur.y);
      prev = cur;
      if (cur.y > 5.2) {
        reachedTop = true;
        break;
      }
    }
  } finally {
    await page.keyboard.up('KeyW');
  }

  expect(
    reachedTop,
    `player must ascend the ramp to body y > 5.2 within 30 s of holding W. ` +
      `maxY=${maxY.toFixed(2)}, trace: ${JSON.stringify(trace.map((t) => ({ x: +t.x.toFixed(2), y: +t.y.toFixed(2) })))}`,
  ).toBe(true);
});
