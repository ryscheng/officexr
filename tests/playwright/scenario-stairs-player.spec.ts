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
 * Geometry: staircase worldAABB x=[0,4], y=[2,6], z=[0,4], ascending
 * toward −X. The colliders come from the GEOMETRY SCANNER
 * (`scanned-cuboids` on prototype_primitive_stairs), which measured
 * the REAL KayKit mesh: 8 steps, stepRise=stepRun=0.5 m (the old
 * hand-authored 16×0.25 spec was a deliberate fake to fit the old
 * 0.4 m autostep limit). Step k (k=0 at the high-X entry) covers
 * x∈[4-(k+1)·0.5, 4-k·0.5] with top at y = 2 + (k+1)·0.5. Settled
 * body root = surface_top − 0.5 (ball bottom = body_root + 0.5,
 * near-zero controller skin).
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

/** Local flat step top at x: 8 real steps (0.5 rise / 0.5 run, per the
 * geometry scan) ascending toward −X from x=4 (top 2.5) to x=0 (top 6.0). */
function stepTopAtX(x: number): number {
  const k = Math.min(7, Math.max(0, Math.floor((4 - x) / 0.5)));
  return 2 + (k + 1) * 0.5;
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

/**
 * Boot the scenario-stairs map in Debug mode, silence bots, and wait
 * for the local player to settle on the spawn platform — which proves
 * the baked-layout colliders are live (no colliders → free-fall →
 * settle timeout). Shared by the drop test and the walk test.
 */
async function bootStairsScenario(page: Page): Promise<void> {
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

  // Silence bots BEFORE waiting for the settle. The default bot and
  // the player drop onto the SAME spawn point at boot; with autostep
  // enabled the player can perch on the bot's ball top mid-fall (a
  // sub-0.4 m "ledge" while overlapping), and silencing the bot
  // mid-drop freezes its store entry in the air — leaving the player
  // standing on a phantom ball instead of the platform.
  await page.evaluate(async () => {
    const bots = (
      window as unknown as {
        __OFFICE_BOTS__?: { setCount: (n: number) => Promise<void> };
      }
    ).__OFFICE_BOTS__;
    if (bots) await bots.setCount(0);
  });

  // Wait until the bot's store entry is actually GONE. A bot silenced
  // mid-drop freezes wherever it was; while its entry lingers, its
  // peer-mirror collider remains a phantom ball in the player's world
  // — and the re-dropped player can land on it (observed: frozen at
  // exactly ball-top height with vel 0 for the whole settle window).
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

  // Re-drop the player now that the spawn area is clear (it may have
  // perched on the bot during the initial shared-spawn drop).
  await teleportSelf(page, { x: 6, y: 3, z: 2 });
  await waitForSettle(page, SPAWN_SETTLED_BODY_Y, 0.1, 'spawn platform');
}

test('stairs: local player settles at per-step heights on baked-layout colliders', async ({
  page,
}) => {
  test.setTimeout(90_000);

  await bootStairsScenario(page);

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

test('stairs: local player WALKS up the staircase under keyboard input', async ({
  page,
}) => {
  // The drop test above proves the colliders EXIST; this one proves
  // they're CLIMBABLE by the player's controller — i.e. autostep +
  // the climb-aware gravity reset in SceneFrame work end to end.
  // This is the test that was missing when "stairs don't work"
  // shipped: bots climbed (their own physics world has autostep),
  // the player didn't.
  test.setTimeout(120_000);

  // Pin the fixed camera azimuth to 90° BEFORE boot. SceneFrame maps
  // WASD through cameraYaw = π − azimuth + movementYawOffset; with
  // azimuth=90°, offset=0 the forward vector is exactly (−1, 0), so
  // holding W walks pure −X — straight up the staircase. The studio's
  // persisted view-config hydrates with a per-section shallow merge
  // (useStudioSettings.mergeViewConfig), so a partial fixedCamera
  // section is safe.
  await page.addInitScript(() => {
    localStorage.setItem(
      'officexr:studio:view-config',
      JSON.stringify({
        fixedCamera: { azimuthDeg: 90, movementYawOffsetDeg: 0 },
      }),
    );
  });

  await bootStairsScenario(page);

  // Stand at the stair base on the platform (x=5, centreline z=2),
  // facing a 5 m walk to the staircase top at x≈0.
  await teleportSelf(page, { x: 5, y: 2.5, z: 2 });
  await waitForSettle(page, SPAWN_SETTLED_BODY_Y, 0.15, 'stair base');

  // Focus the world so SceneFrame accepts keydown (useWorldFocus
  // re-arms on any mousedown outside a [data-studio-panel]).
  await page.locator('canvas').first().click({ position: { x: 200, y: 200 } });

  // Hold W and sample the player pose until they reach the top.
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

      // A spurious fall-respawn teleports the player back to spawn
      // (x jumps from the staircase to ≈6) — fail loudly with the
      // trace rather than timing out.
      if (prev && cur.x > prev.x + 1.5) {
        throw new Error(
          `player reset mid-climb (x ${prev.x.toFixed(2)} → ${cur.x.toFixed(2)}). ` +
            `trace: ${JSON.stringify(trace.map((t) => ({ x: +t.x.toFixed(2), y: +t.y.toFixed(2) })))}`,
        );
      }
      // Monotonic ascent guard (same 0.15 m budget as the bot spec):
      // a real climb never gives back more than solver jitter.
      if (cur.y < maxY - 0.15) {
        throw new Error(
          `player lost height mid-climb (maxY ${maxY.toFixed(2)} → ${cur.y.toFixed(2)}). ` +
            `trace: ${JSON.stringify(trace.map((t) => ({ x: +t.x.toFixed(2), y: +t.y.toFixed(2) })))}`,
        );
      }
      maxY = Math.max(maxY, cur.y);
      prev = cur;

      // Same top threshold as the bot spec: body y > 5.2 = stair top
      // (6.0) − 0.5 body offset − 0.3 tolerance.
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
    `player must climb to body y > 5.2 within 30 s of holding W. ` +
      `maxY=${maxY.toFixed(2)}, trace: ${JSON.stringify(trace.map((t) => ({ x: +t.x.toFixed(2), y: +t.y.toFixed(2) })))}`,
  ).toBe(true);
});
