/**
 * Scenario: Stairs — LOCAL PLAYER collider topology.
 *
 * The bot spec (`scenario-stairs.spec.ts`) exercises BotPhysicsWorld,
 * which builds its colliders from `worldObjects` + `colliderShape`.
 * The LOCAL PLAYER walks on a different collider source:
 * `<BakedLayoutColliders>`, fed by the cuboids the bake embedded in
 * the GLB's scene extras (see `app/baked-collider-extras.ts`). This
 * spec covers that player-side path — nothing else does.
 *
 * Method (same store-teleport pattern as
 * `debug-character-grounded.spec.ts` — no keyboard simulation): drop
 * the self player above three points along the staircase and assert
 * it settles at the LOCAL step height each time, ascending toward −X.
 *
 * Failure modes this distinguishes:
 *   - Merged-visual-AABB regression (colliders derived from the merged
 *     mesh instead of extras): the whole stair footprint becomes one
 *     box with top at y=6.0 → every drop settles at body y≈5.5.
 *     The ascending-heights assertion at x=3.75 / x=2.0 kills this.
 *   - Missing colliders (extras absent + fallback broken): the player
 *     falls through the staircase → settle timeout.
 *
 * Geometry (documented in scenario-stairs.spec.ts; layout
 * `scenario-stairs`): staircase worldAABB x=[0,4], y=[2,6], z=[0,4];
 * 16 steps, stepRise=stepRun=0.25 m, ascending toward −X. Step k
 * (k=0 at the high-X entry) covers x∈[4-(k+1)·0.25, 4-k·0.25] with
 * top at y = 2 + (k+1)·0.25. Settled body root = surface_top − 0.5
 * (ball bottom = body_root + 0.5, near-zero controller skin).
 *
 * Tolerances: the ball (radius 0.4 m) spans ~3 step runs, so it rests
 * on step CORNERS slightly above the flat local step top. Windows are
 * ±~0.45 m around the local flat answer — wide enough for corner
 * rests, far too tight for the 5.5 m AABB failure at the lower drops.
 *
 * Drop heights are settle+1.5 m: max fall speed √(2·20·1.5) ≈ 7.7 m/s
 * stays below MAX_FALL_VELOCITY=8, so the fall-respawn rule can never
 * fire mid-drop by construction.
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { waitForCanvasReady } from './helpers.ts';
import { goToDebugWithMap } from './motion-helpers.ts';

const SELF_ID = 'local-player';

/** Map load gate: scenario-stairs resolves to 9 worldObjects instances
 * (4 base + 1 stairs + 4 landing). */
const STAIRS_INSTANCE_COUNT = 9;

/** Spawn platform top face y=2 → settled body y=1.5. */
const SPAWN_SETTLED_BODY_Y = 1.5;

/** Local flat step top at x: steps ascend toward −X from x=4 (top 2.25)
 * to x=0 (top 6.0). */
function stepTopAtX(x: number): number {
  const k = Math.min(15, Math.max(0, Math.floor((4 - x) / 0.25)));
  return 2 + (k + 1) * 0.25;
}

/** Drop points along the staircase centreline (z=2), low → high. */
const DROPS = [
  { x: 3.75, label: 'entry steps' },
  { x: 2.0, label: 'mid staircase' },
  { x: 0.25, label: 'top steps' },
].map((d) => ({
  ...d,
  expectedBodyY: stepTopAtX(d.x) - 0.5,
}));

/** Window half-width around the expected flat settle. Corner rests sit
 * a bit high; nothing legitimate sits 0.45 m off. */
const SETTLE_TOLERANCE = 0.45;

async function teleportSelf(
  page: Page,
  pos: { x: number; y: number; z: number },
): Promise<void> {
  await page.evaluate(
    ({ selfId, pos }: { selfId: string; pos: { x: number; y: number; z: number } }) => {
      (
        window as unknown as {
          __OFFICE_STORE__: {
            setState: (updater: (s: unknown) => unknown) => void;
          };
        }
      ).__OFFICE_STORE__.setState((s: unknown) => {
        const state = s as {
          players: Record<
            string,
            {
              pos: { x: number; y: number; z: number };
              vel: { x: number; y: number; z: number };
              yaw: number;
            }
          >;
        };
        return {
          players: {
            ...state.players,
            [selfId]: {
              ...state.players[selfId],
              pos,
              vel: { x: 0, y: 0, z: 0 },
              yaw: 0,
            },
          },
        };
      });
    },
    { selfId: SELF_ID, pos },
  );
}

async function getSelf(
  page: Page,
): Promise<{ pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number } } | null> {
  return page.evaluate((selfId: string) => {
    const w = window as unknown as {
      __OFFICE_STORE__?: {
        getState: () => {
          players: Record<
            string,
            { pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number } } | undefined
          >;
        };
      };
    };
    const p = w.__OFFICE_STORE__?.getState().players[selfId];
    return p ? { pos: p.pos, vel: p.vel } : null;
  }, SELF_ID);
}

/** Wait until the self player is at rest (|vel.y| ≈ 0) near `expectedY`. */
async function waitForSettle(
  page: Page,
  expectedY: number,
  tolerance: number,
  label: string,
): Promise<number> {
  try {
    await page.waitForFunction(
      ({ selfId, expectedY, tolerance }: { selfId: string; expectedY: number; tolerance: number }) => {
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
        if (!p) return false;
        return (
          Math.abs(p.pos.y - expectedY) < tolerance && Math.abs(p.vel.y) < 0.001
        );
      },
      { selfId: SELF_ID, expectedY, tolerance },
      { timeout: 8_000, polling: 100 },
    );
  } catch {
    const self = await getSelf(page);
    throw new Error(
      `settle timeout at ${label}: expected body.y ≈ ${expectedY} ±${tolerance}, ` +
        `got ${JSON.stringify(self)}`,
    );
  }
  const self = await getSelf(page);
  return self!.pos.y;
}

test('stairs: local player settles at per-step heights on baked-layout colliders', async ({
  page,
}) => {
  test.setTimeout(90_000);

  await goToDebugWithMap(page, 'scenario-stairs');
  await waitForCanvasReady(page, 0, 30_000);

  // Gate on the map being fully loaded: store has the self player AND
  // the 9 resolved instances (task-13 layout resolution).
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
    { selfId: SELF_ID, count: STAIRS_INSTANCE_COUNT },
    { timeout: 30_000, polling: 200 },
  );

  // Silence bots: this spec is about the local player only.
  await page.evaluate(async () => {
    const bots = (
      window as unknown as {
        __OFFICE_BOTS__?: { setCount: (n: number) => Promise<void> };
      }
    ).__OFFICE_BOTS__;
    if (bots) await bots.setCount(0);
  });

  // The map picker dropped the player over spawn [6,2,2]. Settling at
  // body y≈1.5 (platform top 2.0) proves the baked-layout colliders
  // are live — the load gate for everything below. Without colliders
  // the player free-falls and this times out.
  await waitForSettle(page, SPAWN_SETTLED_BODY_Y, 0.1, 'spawn platform');

  // Drop onto three points along the staircase; settled heights must
  // track the LOCAL step tops (ascending toward −X).
  const settled: number[] = [];
  for (const drop of DROPS) {
    await teleportSelf(page, {
      x: drop.x,
      y: drop.expectedBodyY + 1.5,
      z: 2,
    });
    const y = await waitForSettle(
      page,
      drop.expectedBodyY,
      SETTLE_TOLERANCE,
      `${drop.label} (x=${drop.x})`,
    );
    settled.push(y);
  }

  // Heights ascend toward −X. Under the merged-AABB failure mode every
  // drop would read ≈5.5; under per-step colliders the three differ by
  // the staircase slope (≈1.75 m between consecutive drop points).
  expect(
    settled[1] - settled[0],
    `mid (${settled[1]}) must sit well above entry (${settled[0]})`,
  ).toBeGreaterThan(1.0);
  expect(
    settled[2] - settled[1],
    `top (${settled[2]}) must sit well above mid (${settled[1]})`,
  ).toBeGreaterThan(1.0);
});
