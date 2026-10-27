/**
 * Regression for the "character floats above the floor" bug class.
 *
 * Background: an earlier version of `Adventurer.meshOffsetY` sampled
 * every animation clip at 12 frames per clip and used
 * `-(union.min.y)` to anchor the mesh. In every frame other than
 * the deepest stride dip, the mesh ended up rendered ABOVE the
 * cube top by the dip depth — visible as a 5–10 cm constant float
 * during idle. The fix is to use bind-pose extents only.
 *
 * This spec asserts the two invariants that prove the fix is in
 * place under Debug mode (where animations actually play):
 *
 *   1. The physics body settles on the cube — body root y lands at
 *      ~0.51 m for a cube whose top is at y=1 (body root + 0.5
 *      = ball bottom = cube top + 1 cm controller skin).
 *   2. `__OFFICE_MESH_DEBUG__.offset === -__OFFICE_MESH_DEBUG__.minY`.
 *      The per-frame-sampling regression would make
 *      `offset > -minY` (i.e. union dip below bind-pose min); the
 *      bind-pose-only path makes the equation hold exactly.
 *
 * No screenshot diff — the mugshot baseline tests serve the
 * pixel-net role for the paused case. This spec is pure numeric
 * and runs in <10 s.
 */
import { test, expect } from '@playwright/test';
import { waitForCanvasReady } from './helpers.ts';

const SELF_ID = 'local-player';
// Voxel position [0,0,0] at cubeSize=2 → world cube center (0, 1, 0)
// (MapColliders applies `voxelY * cubeSize + cubeSize/2`, lifting the
// y=0 row half a cube above world y=0). Cube top is therefore at
// world y=2. Ball collider bottom = body.y + (BODY_Y - charRadius)
// = body.y + 0.5. The controller skin is near-zero
// (CHARACTER_CONTROLLER_SKIN ≈ 0.0001), so the character settles ON
// the cube: ball bottom = cube top → settled body.y ≈ 1.50 (feet flush
// at y=2.00, no float).
const CUBE_TOP_Y = 2;
const SETTLED_BODY_Y = 1.5;

test('Debug character stands on cube — bind-pose anchor, no float', async ({
  page,
}) => {
  test.setTimeout(60_000);

  await page.goto('/#debug', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await waitForCanvasReady(page, 0, 30_000);

  // Wait for store + self player + Adventurer's first
  // __OFFICE_MESH_DEBUG__ publish (character clone loaded).
  await page.waitForFunction(
    (selfId: string) => {
      const w = window as unknown as {
        __OFFICE_STORE__?: {
          getState: () => { players: Record<string, unknown> };
        };
        __OFFICE_MESH_DEBUG__?: { minY: number };
      };
      return Boolean(
        w.__OFFICE_STORE__?.getState().players[selfId] && w.__OFFICE_MESH_DEBUG__,
      );
    },
    SELF_ID,
    { timeout: 20_000, polling: 200 },
  );

  // Silence bots so they don't compete for the cube and so their
  // own mesh-debug publishes don't overwrite ours mid-test. (The
  // singleton `__OFFICE_MESH_DEBUG__` is "whichever Adventurer
  // anchored last"; without other characters we can rely on it
  // belonging to the self player.)
  await page.evaluate(async () => {
    const bots = (
      window as unknown as {
        __OFFICE_BOTS__?: { setCount: (n: number) => Promise<void> };
      }
    ).__OFFICE_BOTS__;
    if (bots) await bots.setCount(0);
  });
  await page.waitForTimeout(500);

  // Replace the loaded map with a single cube whose top is at y=1.
  // `worldObjects.instances[].position` is voxel-space; for the
  // default cubeSize=2, voxel (0,0,0) is the world cube centered at
  // origin with top face at y=1. MapColliders subscribes to the
  // store and rebuilds physics colliders on this change.
  await page.evaluate(() => {
    (
      window as unknown as {
        __OFFICE_STORE__: {
          setState: (updater: (s: unknown) => unknown) => void;
        };
      }
    ).__OFFICE_STORE__.setState(() => ({
      worldObjects: {
        cubeSize: 2,
        instances: [
          {
            id: 'grounded-test-cube',
            sourceCommandId: 'grounded-test',
            kindId: 'colored_block_blue',
            position: [0, 0, 0],
          },
        ],
      },
    }));
  });
  // MapColliders subscription + Rapier collider build takes a frame
  // or two.
  await page.waitForTimeout(300);

  // Drop the self player from y=4 directly above the cube. Set the
  // position straight into the store; SceneFrame's auto-warp picks
  // up the large delta (>0.5 m threshold with gravity on) and
  // teleports the kinematic body. Gravity then settles the body
  // onto the cube.
  await page.evaluate((selfId: string) => {
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
            pos: { x: 0, y: 4, z: 0 },
            vel: { x: 0, y: 0, z: 0 },
            yaw: 0,
          },
        },
      };
    });
  }, SELF_ID);

  // Wait for body to settle: ball must touch cube top, vel.y → 0.
  // From y=4 to settle at y=1.51 with GRAVITY=-20: free-fall
  // time = sqrt(2 * 2.49 / 20) ≈ 0.5 s. Add a beat for
  // computedGrounded to zero vy. Cap at 8 s for cold cache.
  try {
    await page.waitForFunction(
      ({ selfId, settledY }: { selfId: string; settledY: number }) => {
        const state = (
          window as unknown as {
            __OFFICE_STORE__: {
              getState: () => {
                players: Record<
                  string,
                  | { pos: { y: number }; vel: { y: number } }
                  | undefined
                >;
              };
            };
          }
        ).__OFFICE_STORE__.getState();
        const p = state.players[selfId];
        if (!p) return false;
        return (
          Math.abs(p.pos.y - settledY) < 0.05 && Math.abs(p.vel.y) < 0.001
        );
      },
      { selfId: SELF_ID, settledY: SETTLED_BODY_Y },
      { timeout: 8_000, polling: 100 },
    );
  } catch {
    const dbg = await page.evaluate((selfId: string) => {
      const state = (
        window as unknown as {
          __OFFICE_STORE__: {
            getState: () => {
              players: Record<string, { pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number } } | undefined>;
              worldObjects: { instances: Array<{ id: string; position: [number, number, number] }> };
            };
          };
        }
      ).__OFFICE_STORE__.getState();
      return {
        playerPos: state.players[selfId]?.pos,
        playerVel: state.players[selfId]?.vel,
        cubeCount: state.worldObjects.instances.length,
        cubes: state.worldObjects.instances.map((i) => ({ id: i.id, position: i.position })),
      };
    }, SELF_ID);
    throw new Error(
      `settle timeout. expected body.y ≈ ${SETTLED_BODY_Y}, got: ${JSON.stringify(dbg)}`,
    );
  }

  // Numeric pulls.
  const result = await page.evaluate((selfId: string) => {
    const state = (
      window as unknown as {
        __OFFICE_STORE__: {
          getState: () => {
            players: Record<
              string,
              { pos: { y: number }; vel: { y: number } } | undefined
            >;
          };
        };
      }
    ).__OFFICE_STORE__.getState();
    const md = (
      window as unknown as {
        __OFFICE_MESH_DEBUG__?: {
          minY: number;
          maxY: number;
          offset: number;
        };
      }
    ).__OFFICE_MESH_DEBUG__;
    return {
      bodyY: state.players[selfId]?.pos.y ?? null,
      velY: state.players[selfId]?.vel.y ?? null,
      meshDebug: md ?? null,
    };
  }, SELF_ID);

  // 1. Body settled.
  expect(result.bodyY).not.toBeNull();
  expect(
    Math.abs((result.bodyY as number) - SETTLED_BODY_Y),
    `body.y settled near ${SETTLED_BODY_Y}, got ${result.bodyY}`,
  ).toBeLessThan(0.05);

  // 2. Mesh-debug published.
  expect(result.meshDebug, 'Adventurer published __OFFICE_MESH_DEBUG__').not.toBeNull();
  const md = result.meshDebug!;
  expect(isFinite(md.minY), 'minY finite').toBe(true);
  expect(isFinite(md.maxY), 'maxY finite').toBe(true);
  expect(isFinite(md.offset), 'offset finite').toBe(true);

  // 3. The load-bearing assertion: `offset === -minY` (bind-pose
  //    only). Per-frame sampling regression would make minY drop
  //    below the bind-pose extent — `offset` (set to -union.min.y)
  //    would then exceed -minY by the dip depth.
  expect(
    Math.abs(md.offset - -md.minY),
    `offset (${md.offset}) must equal -minY (${-md.minY}) ` +
      `within 1e-5 — bind-pose-only anchoring. Drift means the ` +
      `per-frame sampling lift is back.`,
  ).toBeLessThan(1e-5);

  // 4. Sanity: the bind-pose mesh has its lowest vertex at or
  //    slightly below the model origin (KayKit puts the origin
  //    near the feet). minY in the range [-1.0, 0] is normal; a
  //    minY > 0 would mean we're not lifting the model at all,
  //    which is wrong for any rig where the origin isn't AT the
  //    feet.
  expect(md.minY).toBeLessThanOrEqual(0);
  expect(md.minY).toBeGreaterThan(-1.0);

  // 5. World-space mesh feet land flush on the cube top (±2 cm).
  //    feet_y = body.y + wrapper (0.5) + offset + minY
  //           = body.y + 0.5  (because offset + minY = 0 by #3)
  //    With the near-zero controller skin the body settles flush, so
  //    this should equal cube_top (≈2.00), not cube_top + a float.
  const feetY = (result.bodyY as number) + 0.5 + md.offset + md.minY;
  expect(
    Math.abs(feetY - CUBE_TOP_Y),
    `mesh feet world y (${feetY}) must land flush on cube_top ` +
      `(${CUBE_TOP_Y}) within 2 cm`,
  ).toBeLessThan(0.02);
});
