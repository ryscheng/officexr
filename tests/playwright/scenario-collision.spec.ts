/**
 * Scenario: Two-Bot Head-On Collision
 *
 * Two bots in `linear-walk` mode walk toward each other on a 4×4-block
 * platform (scenario-collision map) until they meet and are blocked by peer
 * kinematic mirrors inside BotPhysicsWorld. This spec asserts:
 *
 *   1. Both bots' VELOCITY VECTORS (vel.x, vel.z) are non-zero during the
 *      walk phase — confirming walk() through CharacterMovement produces
 *      broadcastVel.
 *   2. Both bots' VELOCITY VECTORS drop to ≈zero when blocked —
 *      BotCharacterMovement returns animState:'idle' + broadcastVel:{0,0,0}
 *      when progress < movementBlockThreshold.
 *   3. Both bots' POSITIONS STABILIZE (Δ < 0.05 m over 1 s) after blocking.
 *   4. Neither bot falls off or respawns (dual-gate false-positive guard).
 *
 * This spec exercises the real shared movement path:
 *   setLinearWalkDir(idx, dir)
 *   → BotDriver.setModeWithConfig('linear-walk', {direction})
 *   → each tick: linearWalkStrategy.computeIntent() → {x,z}
 *   → BotDriver.tick() → movement.walk({x,z}, yaw, dt)
 *   → BotCharacterMovement._step() → BotPhysicsWorld.step()
 *   → peer kinematic mirrors block forward progress
 *   → _step returns {animState:'idle', broadcastVel:{0,0,0}}
 *   → SyncEngine broadcasts zero vel to SDK store
 *
 * Map geometry (scenario-collision layout):
 *   - 16 colored_block_blue at voxelSize=0.5, voxel positions
 *     x∈{0,4,8,12}, z∈{0,4,8,12}
 *   - 1 voxel unit × voxelSize=0.5 → 0.5 m; "voxelSize × 4" means each
 *     block occupies 4 voxel units → 2 m per block side.
 *   - Platform: 4 blocks × 2 m = 8 m in both X and Z → [0,8] × [0,8].
 *   - Platform top face at world Y = 2 m.
 *   - KCC settles at y ≈ 1.5 (ball bottom = body_root + 0.5 = floor_top = 2).
 *   - Spawn points in test: near {x:3, y:0, z:1} (bot-0) and far {x:3, y:0, z:7} (bot-1).
 *
 * Spawn rationale (y=0, x=3 not x=4):
 *   y=0 places the bot body inside the floor block (y=[0,2]). The KCC resolves the
 *   sphere upward — same as scenario-corridor.spec.ts spawn at {x:0,y:0,z:0}.
 *   x=3 instead of x=4: world x=4 is exactly the boundary between voxelPos(4,0,z)
 *   block x=[2,4] and voxelPos(8,0,z) block x=[4,6]. At x=4,y=0 the sphere touches
 *   both block faces on the X axis simultaneously; the KCC can produce ambiguous y
 *   resolution (two equal-depth X contacts cancel, leaving only a tiny y overlap
 *   push that may be dominated by the downward gravity delta). Using x=3 centers the
 *   sphere inside the single block x=[2,4], giving an unambiguous upward push to y≈1.5.
 *   Pattern identical to scenario-corridor.spec.ts (x=0 is also inside a single block).
 *
 * 2 keyframe PNGs captured: approaching (both bots walking toward each other)
 * and blocked (both stopped face-to-face, positions stable).
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { waitForCanvasReady } from './helpers.ts';
import {
  goToDebugWithMap,
  waitForBotsHook,
  waitForBotCondition,
  captureMotionKeyframe,
  readMotionManifest,
} from './motion-helpers.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BOT0_ID = 'bot-001';
const BOT1_ID = 'bot-002';

/**
 * The collision map has 16 worldObjects instances after task-13 layout
 * resolution. We wait for this count before placing bots so BotPhysicsWorld
 * has floor colliders before the first physics tick.
 */
const COLLISION_INSTANCE_COUNT = 16;

/**
 * Platform top face at world Y=2. KCC body root settles at y≈1.5
 * (ball bottom = body_root + 0.5 = platform_top = 2.0).
 * Tolerating ±0.35 to match corridor spec behavior.
 */
const SETTLED_BODY_Y = 1.5;
const SETTLED_TOLERANCE = 0.35;

const MANIFEST = readMotionManifest('scenario-collision');

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

interface BotState {
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
}

async function getBotState(page: Page, botId: string): Promise<BotState | null> {
  return page.evaluate((id: string) => {
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
    if (!w.__OFFICE_STORE__) return null;
    const p = w.__OFFICE_STORE__.getState().players[id];
    return p ? { pos: p.pos, vel: p.vel } : null;
  }, botId);
}

async function getBotPos(page: Page, botId: string): Promise<{ x: number; y: number; z: number }> {
  const state = await getBotState(page, botId);
  if (!state) throw new Error(`getBotPos: bot ${botId} not found in store`);
  return state.pos;
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

test('collision: two bots walk head-on, collide, and are blocked with zero vel', async ({
  page,
}) => {
  test.setTimeout(90_000);

  // ------------------------------------------------------------------
  // Setup
  // ------------------------------------------------------------------

  // 1. Navigate to /#debug with the scenario-collision map pre-loaded via
  //    localStorage. goToDebugWithMap sets the key before navigation so
  //    DebugApp's useMapPicker picks it up on boot.
  await goToDebugWithMap(page, 'scenario-collision');

  // 2. Wait for the R3F canvas to mount.
  await waitForCanvasReady(page, 0, 30_000);

  // 3. Wait for the bot pool to publish __OFFICE_BOTS__ on window.
  await waitForBotsHook(page);

  // 4. Spawn two bots in IDLE mode so they settle on the platform before
  //    walking. Setting walk directions first caused bots to start walking
  //    immediately, often passing through each other before the platform
  //    settling wait could catch a stable state.
  await page.evaluate(async () => {
    const bots = (
      window as unknown as {
        __OFFICE_BOTS__?: {
          setCount: (n: number) => Promise<void>;
          setMode: (mode: string) => void;
        };
      }
    ).__OFFICE_BOTS__;
    if (!bots) throw new Error('__OFFICE_BOTS__ not available');
    await bots.setCount(2);
    // Start in idle mode — bots will settle under gravity before walking.
    bots.setMode('idle');
  });

  // 5. Wait deterministically for the map's layout geometry to reach the store.
  //    Task-13 wires useMapPicker to load layouts for baked-only rooms and pass
  //    them to compileMap. The 16 collision platform instances are broadcast via
  //    the in-memory channel → bot's SyncEngine → BotPhysicsWorld.syncCubes().
  //    Polling instead of a fixed sleep ensures bots have floor colliders before
  //    we place them.
  await page.waitForFunction(
    (minCount: number) => {
      const w = window as unknown as {
        __OFFICE_STORE__?: {
          getState: () => {
            worldObjects?: { instances?: unknown[] };
          };
        };
      };
      const instances = w.__OFFICE_STORE__?.getState().worldObjects?.instances;
      return Array.isArray(instances) && instances.length >= minCount;
    },
    COLLISION_INSTANCE_COUNT,
    { timeout: 20_000, polling: 200 },
  );

  // 6. Teleport bot-0 to near-Z spawn (z=1) and bot-1 to far-Z spawn (z=7).
  //    y=0 places bots inside the floor; the KCC resolves upward to y≈1.5 on
  //    the first physics step — identical to scenario-corridor.spec.ts.
  //    respawnAll maps bot-0 → spawns[0], bot-1 → spawns[1].
  //
  //    x=3 (not x=4): world x=4 falls exactly on the boundary between two blocks
  //    (voxelPos(4,...) → world x=[2,4] and voxelPos(8,...) → world x=[4,6]).
  //    A sphere at x=4,y=0 touches both block faces simultaneously; the KCC
  //    cannot resolve upward cleanly (two equal-depth contacts on opposing x faces
  //    produce a net zero x-push, and the y-push may cancel depending on which
  //    normal wins). Using x=3 places the sphere inside the single block x=[2,4],
  //    giving the KCC an unambiguous upward push to y≈1.5.
  await page.evaluate(() => {
    const bots = (
      window as unknown as {
        __OFFICE_BOTS__?: {
          respawnAll: (spawns: ReadonlyArray<{ x: number; y: number; z: number }>) => void;
        };
      }
    ).__OFFICE_BOTS__;
    if (!bots) throw new Error('__OFFICE_BOTS__ not available');
    // x=3 is inside block x=[2,4] (voxelPos(4,0,z) → world x=[2,4]). Avoids the
    // x=4 boundary ambiguity. Near-Z end (bot-0) and far-Z end (bot-1) of the 8m platform.
    bots.respawnAll([
      { x: 3, y: 0, z: 1 },
      { x: 3, y: 0, z: 7 },
    ]);
  });

  // Brief settle — let physics resolve the initial drop.
  await page.waitForTimeout(500);

  // Confirm both bots appear in the store before proceeding.
  await page.waitForFunction(
    ([b0, b1]: [string, string]) => {
      const w = window as unknown as {
        __OFFICE_STORE__?: {
          getState: () => { players: Record<string, unknown> };
        };
      };
      const state = w.__OFFICE_STORE__?.getState();
      return Boolean(state?.players[b0]) && Boolean(state?.players[b1]);
    },
    [BOT0_ID, BOT1_ID] as [string, string],
    { timeout: 15_000, polling: 200 },
  );

  // 7. Wait for both bots to GENUINELY settle on platform at y≈1.5.
  //    We poll for 300ms of consistent y ≈ 1.5 to guard against false positives
  //    where the bot is falling THROUGH the floor block (y=0 to y=2) and
  //    momentarily passes through the y=1.5 window without being settled.
  //    NOTE: predicates are serialised to the browser — literal values only.
  //
  //    First wait for the bot to be in the settled window.
  await waitForBotCondition(
    page,
    BOT0_ID,
    (pos) => Math.abs(pos.y - 1.5) < 0.35,
    15_000,
  );
  await waitForBotCondition(
    page,
    BOT1_ID,
    (pos) => Math.abs(pos.y - 1.5) < 0.35,
    15_000,
  );
  // Brief extra settle to ensure both bots are truly resting (not just passing
  // through y≈1.5 during a respawn fall). At this point the bots are in idle
  // mode, so any genuine settling produces position stability within 200ms.
  await page.waitForTimeout(400);

  // Diagnostic: log both bots' state after settling.
  {
    const s0 = await getBotState(page, BOT0_ID);
    const s1 = await getBotState(page, BOT1_ID);
    console.log(`POST-SETTLE: bot0 (y=${s0?.pos.y.toFixed(3)} z=${s0?.pos.z.toFixed(3)} vz=${s0?.vel.z.toFixed(3)}) | bot1 (y=${s1?.pos.y.toFixed(3)} z=${s1?.pos.z.toFixed(3)} vz=${s1?.vel.z.toFixed(3)})`);
  }

  // 8. NOW set walk directions (after settling). Starting the walk after
  //    the bots are stationary on the platform guarantees a clean head-on
  //    approach from known positions. Both bots are already at the spawn
  //    points (z≈1 and z≈7) and will walk toward each other.
  await page.evaluate(() => {
    const bots = (
      window as unknown as {
        __OFFICE_BOTS__?: {
          setLinearWalkDir: (idx: number, dir: { x: number; z: number }) => void;
        };
      }
    ).__OFFICE_BOTS__;
    if (!bots) throw new Error('__OFFICE_BOTS__ not available');
    // Bot-0 (bot-001): near-Z end, walks in +Z direction toward bot-1.
    bots.setLinearWalkDir(0, { x: 0, z: 1 });
    // Bot-1 (bot-002): far-Z end, walks in -Z direction toward bot-0.
    bots.setLinearWalkDir(1, { x: 0, z: -1 });
  });

  // ------------------------------------------------------------------
  // Phase 1 — Approaching (velocity vector assertion)
  // ------------------------------------------------------------------

  // The real walk() path via BotCharacterMovement produces positive
  // broadcastVel.z for bot-0 and negative broadcastVel.z for bot-1.
  // This distinguishes real movement from an "idle" state where vel is zero.
  await waitForBotCondition(
    page,
    BOT0_ID,
    // Bot-0 walks in +Z: broadcastVel.z must be positive.
    // Also wait until bot-0 has moved at least 0.5 m from its start (z > 1.5)
    // so the render is in a consistent walking state before keyframe capture.
    (pos, vel) => vel.z > 0.1 && pos.z > 1.5,
    10_000,
  );
  await waitForBotCondition(
    page,
    BOT1_ID,
    // Bot-1 walks in -Z: broadcastVel.z must be negative.
    // Also wait until bot-1 has moved at least 0.5 m from its start (z < 6.5).
    (pos, vel) => vel.z < -0.1 && pos.z < 6.5,
    10_000,
  );

  // Diagnostic: log both bots' state at Phase 1 (approaching).
  {
    const s0 = await getBotState(page, BOT0_ID);
    const s1 = await getBotState(page, BOT1_ID);
    console.log(`PHASE1-APPROACH: bot0 (y=${s0?.pos.y.toFixed(3)} z=${s0?.pos.z.toFixed(3)} vz=${s0?.vel.z.toFixed(3)}) | bot1 (y=${s1?.pos.y.toFixed(3)} z=${s1?.pos.z.toFixed(3)} vz=${s1?.vel.z.toFixed(3)})`);
  }

  // Keyframe 1: both bots approaching from opposite ends of the platform.
  // Capture while both are actively moving (velocity vectors confirmed above).
  // Non-committed capture because toHaveScreenshot's stability check requires
  // two identical consecutive frames — not guaranteed while bots are walking
  // (Three.js rAF loop runs independently of CSS animation disabling).
  // The numeric assertions above are the real regression gate; the PNG is
  // produced as a per-run artifact in `test-results/motion-captures/` so CI
  // can attach it to PR reviews for humans to eyeball.
  await captureMotionKeyframe(page, 'keyframe-01-approaching.png', {
    committed: false,
  });

  // ------------------------------------------------------------------
  // Phase 2 — Contact detected
  // ------------------------------------------------------------------

  // Wait until the two bots' Z positions are within 1.5 m of each other.
  // At that range (just under 2× charRadius = 0.8 m contact sum), the
  // next few physics ticks produce full blocking.
  await page.waitForFunction(
    ([b0, b1]: [string, string]) => {
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
      const state = w.__OFFICE_STORE__?.getState();
      if (!state) return false;
      const p0 = state.players[b0]?.pos;
      const p1 = state.players[b1]?.pos;
      if (!p0 || !p1) return false;
      return Math.abs(p0.z - p1.z) < 1.5;
    },
    [BOT0_ID, BOT1_ID] as [string, string],
    { timeout: 15_000, polling: 100 },
  );

  // Diagnostic: log both bots' state at Phase 2 (contact).
  {
    const s0 = await getBotState(page, BOT0_ID);
    const s1 = await getBotState(page, BOT1_ID);
    console.log(`PHASE2-CONTACT: bot0 (y=${s0?.pos.y.toFixed(3)} z=${s0?.pos.z.toFixed(3)} vz=${s0?.vel.z.toFixed(3)}) | bot1 (y=${s1?.pos.y.toFixed(3)} z=${s1?.pos.z.toFixed(3)} vz=${s1?.vel.z.toFixed(3)})`);
  }

  // ------------------------------------------------------------------
  // Phase 3 — Blocked (velocity vector assertion — CharacterMovement blocked)
  // ------------------------------------------------------------------

  // Diagnostic: poll for 3s to observe z and vel evolution after contact.
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(100);
    const pollState = await page.evaluate(([b0, b1]: [string, string]) => {
      const w = window as unknown as {
        __OFFICE_STORE__?: {
          getState: () => {
            players: Record<string, { pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number } } | undefined>;
          };
        };
      };
      const state = w.__OFFICE_STORE__?.getState();
      const p0 = state?.players[b0];
      const p1 = state?.players[b1];
      return {
        p0z: p0?.pos.z?.toFixed(3), p0y: p0?.pos.y?.toFixed(3), p0vz: p0?.vel.z?.toFixed(3),
        p1z: p1?.pos.z?.toFixed(3), p1y: p1?.pos.y?.toFixed(3), p1vz: p1?.vel.z?.toFixed(3)
      };
    }, [BOT0_ID, BOT1_ID] as [string, string]);
    console.log(`Poll ${i}: bot0 (y=${pollState.p0y} z=${pollState.p0z} vz=${pollState.p0vz}) | bot1 (y=${pollState.p1y} z=${pollState.p1z} vz=${pollState.p1vz})`);
  }

  // When walk() is fully blocked (progress < movementBlockThreshold),
  // BotCharacterMovement returns animState:'idle' and broadcastVel:{0,0,0}.
  // The position-broadcaster estimates vel from position delta — when the
  // bot is truly stopped, position delta = 0 → estimated vel ≈ 0.
  //
  // This is the KEY VECTOR assertion: both x and z components must be ≈zero.
  // A bot that passed through the other would still have non-zero vel.z here.
  await page.waitForFunction(
    ([b0, b1]: [string, string]) => {
      const w = window as unknown as {
        __OFFICE_STORE__?: {
          getState: () => {
            players: Record<
              string,
              { vel: { x: number; y: number; z: number } } | undefined
            >;
          };
        };
      };
      const state = w.__OFFICE_STORE__?.getState();
      if (!state) return false;
      const v0 = state.players[b0]?.vel;
      const v1 = state.players[b1]?.vel;
      if (!v0 || !v1) return false;
      const blocked0 = Math.abs(v0.x) < 0.05 && Math.abs(v0.z) < 0.05;
      const blocked1 = Math.abs(v1.x) < 0.05 && Math.abs(v1.z) < 0.05;
      return blocked0 && blocked1;
    },
    [BOT0_ID, BOT1_ID] as [string, string],
    { timeout: 10_000, polling: 100 },
  );

  // Keyframe 2: both bots blocked face-to-face, positions stable, vel≈zero.
  // Non-committed capture for the same reason as keyframe-01: Three.js rAF
  // continues rendering (lighting, post-processing) even when characters are
  // stationary, so toHaveScreenshot's pixel-stability check times out.
  // The numeric assertions in Phase 3 (vel ≈ 0) and Phase 4 (Δpos < 0.05 m)
  // are the real regression gate; the PNG lands in `test-results/motion-
  // captures/` as a per-run artifact for CI to surface in PR reviews.
  await captureMotionKeyframe(page, 'keyframe-02-blocked.png', {
    committed: false,
  });

  // ------------------------------------------------------------------
  // Phase 4 — Position stability
  // ------------------------------------------------------------------

  const pos0Before = await getBotPos(page, BOT0_ID);
  const pos1Before = await getBotPos(page, BOT1_ID);

  await page.waitForTimeout(1_000);

  const pos0After = await getBotPos(page, BOT0_ID);
  const pos1After = await getBotPos(page, BOT1_ID);

  const delta0 = Math.hypot(pos0After.x - pos0Before.x, pos0After.z - pos0Before.z);
  const delta1 = Math.hypot(pos1After.x - pos1Before.x, pos1After.z - pos1Before.z);

  expect(
    delta0,
    `bot-0 should be stable (blocked): Δ=${delta0.toFixed(4)} m over 1 s ` +
      `(start z=${pos0Before.z.toFixed(3)}, end z=${pos0After.z.toFixed(3)})`,
  ).toBeLessThan(MANIFEST.assertionThresholds.positionTolerance);

  expect(
    delta1,
    `bot-1 should be stable (blocked): Δ=${delta1.toFixed(4)} m over 1 s ` +
      `(start z=${pos1Before.z.toFixed(3)}, end z=${pos1After.z.toFixed(3)})`,
  ).toBeLessThan(MANIFEST.assertionThresholds.positionTolerance);

  // ------------------------------------------------------------------
  // Phase 5 — Neither bot respawned (dual-gate regression check)
  // ------------------------------------------------------------------

  // Both bots should remain on the platform (y≈1.5) after blocking.
  // If the floor probe (hasFloorUnderneath) returned a false negative while
  // two bodies are in contact, the dual-gate rule would fire a false respawn.
  // This assertion guards against that regression.
  const final0 = await getBotState(page, BOT0_ID);
  const final1 = await getBotState(page, BOT1_ID);

  expect(final0, 'bot-001 found in store after blocking').not.toBeNull();
  expect(final1, 'bot-002 found in store after blocking').not.toBeNull();

  expect(
    Math.abs(final0!.pos.y - SETTLED_BODY_Y),
    `bot-0 must remain on platform (pos.y=${final0!.pos.y.toFixed(3)}, ` +
      `expected ≈${SETTLED_BODY_Y} ± ${SETTLED_TOLERANCE})`,
  ).toBeLessThan(SETTLED_TOLERANCE);

  expect(
    Math.abs(final1!.pos.y - SETTLED_BODY_Y),
    `bot-1 must remain on platform (pos.y=${final1!.pos.y.toFixed(3)}, ` +
      `expected ≈${SETTLED_BODY_Y} ± ${SETTLED_TOLERANCE})`,
  ).toBeLessThan(SETTLED_TOLERANCE);
});
