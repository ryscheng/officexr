/**
 * Scenario: Walk-off-and-Respawn Corridor
 *
 * A bot in `linear-walk` mode walks along the 2×4m × 16m corridor in +Z,
 * walks off the far edge, falls (vel.y ≤ −8 per the dual-gate rule),
 * triggers respawn via the dual-gate rule (shouldRespawnFalling), and
 * returns to the spawn point.
 *
 * This spec exercises the REAL shared production movement path:
 *   setLinearWalkDir(0, {x:0,z:1})
 *   → BotDriver.setModeWithConfig('linear-walk', {direction:{x:0,z:1}})
 *   → each tick: linearWalkStrategy.computeIntent() → {x:0,z:1}
 *   → BotDriver.tick() → movement.walk({x:0,z:1}, yaw, dt)
 *   → BotCharacterMovement._step() → BotPhysicsWorld.step()
 *   → gravity, collision resolution, floor probe
 *   → shouldRespawnFalling(velY, hasFloorUnderneath) triggers teleport
 *
 * The same CharacterMovement interface governs the human player.
 *
 * Map geometry (from implementation-notes.md §Task 06):
 *   - Layout: 16 colored_block_blue, voxels x∈{0,4}, z∈{0,4,8,…,28}
 *   - voxelSize=0.5 → world AABB x=[0,4], y=[0,2], z=[0,16]; top face at y=2
 *   - Bot body root settles at y≈1.5 (ball bottom = body_root+0.5 = platform top=2.0)
 *   - Spawn point: {x:0, y:0, z:0} in scenario-corridor.json; KCC pushes bot upward
 *     from inside the platform to settled y≈1.5 on the first physics step.
 *   - Fall-respawn: pickRespawnPosition adds SPAWN_DROP_HEIGHT=4 → drops from y=4.
 *     At y=4, velY=-8 fires at body.y≈2.4; floor (y=2) IS within FLOOR_PROBE_RANGE=2
 *     → hasFloorUnderneath=true → dual-gate NOT met → bot lands normally at y≈1.5.
 *
 * Task-13 resolution (baked-layout worldObjects):
 *   useMapPicker now loads layouts for baked-only rooms and passes them to
 *   compileMap via the getLayout resolver. So `worldObjects.instances` is
 *   populated with 16 real per-cube colliders from the authored layout when
 *   scenario-corridor loads. BotPhysicsWorld.syncCubes() receives these colliders
 *   and builds the static Rapier floor. No store injection required.
 *
 *   The spec polls `__OFFICE_STORE__.getState().worldObjects.instances.length`
 *   deterministically instead of the former 3 s fixed sleep.
 *
 * Assertions:
 *   Phase 1 — settled on platform: pos.y≈1.5, |vel.y|<0.1
 *   Phase 2 — walking +Z: pos.z increases ≥1m over 3s
 *   Phase 3a — reached far edge: pos.z > 15 (proves bot walked the full corridor)
 *   Phase 3b — fall velocity vector: vel.y ≤ -4 m/s observed in the store (PRD S1 #3)
 *              PositionBroadcaster overwrites broadcast vel with a position-delta estimate,
 *              so the observer store does see a strongly negative vel.y during the fall.
 *              Internal broadcastVel.y=0; the store vel.y is delta-estimated by the broadcaster.
 *   Phase 4 — respawned: pos.z < 1 && pos.y > 3.5 (respawn teleport) then settled
 *
 * 3 keyframe PNGs captured at semantic moments (on-platform, falling, respawned).
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

const BOT_ID = 'bot-001';

/**
 * Platform top face is at world y=2. The Rapier kinematic body root
 * settles at y≈1.5 (ball bottom = body_root + 0.5 = platform_top = 2.0).
 * See debug-character-grounded.spec.ts for derivation.
 *
 * Used as DOCUMENTATION for the literal values inside predicates.
 * Predicates are serialised to the browser via Function.toString() —
 * node-side variables are not available there, so the literals are
 * inlined directly.
 */
const SETTLED_BODY_Y = 1.5; // eslint-disable-line @typescript-eslint/no-unused-vars
const SETTLED_TOLERANCE = 0.3; // eslint-disable-line @typescript-eslint/no-unused-vars

/**
 * Downward velocity threshold for the dual-gate fall-respawn rule.
 * Matches MAX_FALL_VELOCITY in packages/world/src/physics/rules.ts.
 *
 * The internal Rapier velY accumulator reaches -8 m/s (= -MAX_FALL_VELOCITY)
 * during free fall. The OBSERVER store (via PositionBroadcaster's position-delta
 * estimate) shows a less extreme value because the broadcaster fires at ~30 Hz
 * and only covers the Δy since the last broadcast. -4 m/s is the observable
 * threshold used in Phase 3b (see assertion comment there).
 *
 * Used as DOCUMENTATION for the literal values inside predicates.
 * Predicates are serialised to the browser via Function.toString() —
 * node-side variables are not available there, so the literals are
 * inlined directly.
 */
const MAX_FALL_VELOCITY = 8; // m/s, positive magnitude — eslint-disable-line @typescript-eslint/no-unused-vars

/**
 * The corridor has 16 worldObjects instances after task-13 layout resolution.
 * We wait for this count before placing the bot to ensure the physics world
 * has its floor colliders before the first tick.
 */
const CORRIDOR_INSTANCE_COUNT = 16;

const MANIFEST = readMotionManifest('scenario-corridor');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getBotState(
  page: Page,
  botId: string,
): Promise<{ pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number } } | null> {
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

async function getBotZ(page: Page, botId: string): Promise<number> {
  const state = await getBotState(page, botId);
  if (!state) throw new Error(`getBotZ: bot ${botId} not found in store`);
  return state.pos.z;
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

test('corridor: bot walks in +Z, falls off far end, respawns at spawn point', async ({
  page,
}) => {
  test.setTimeout(90_000);

  // ------------------------------------------------------------------
  // Setup
  // ------------------------------------------------------------------

  // 1. Navigate to /#debug with the scenario-corridor map pre-loaded via
  //    localStorage. goToDebugWithMap sets the key before navigation so
  //    DebugApp's useMapPicker picks it up on boot.
  await goToDebugWithMap(page, 'scenario-corridor');

  // 2. Wait for the R3F canvas to mount.
  await waitForCanvasReady(page, 0, 30_000);

  // 3. Wait for the bot pool to publish __OFFICE_BOTS__ on window.
  await waitForBotsHook(page);

  // 4. Spawn one bot and configure it for linear-walk +Z.
  //    setCount(1) awaits BotDriver.start() (Rapier init + SyncEngine start).
  //    setLinearWalkDir wires direction and mode before the bot's first tick.
  await page.evaluate(async () => {
    const bots = (
      window as unknown as {
        __OFFICE_BOTS__?: {
          setCount: (n: number) => Promise<void>;
          setLinearWalkDir: (idx: number, dir: { x: number; z: number }) => void;
        };
      }
    ).__OFFICE_BOTS__;
    if (!bots) throw new Error('__OFFICE_BOTS__ not available');
    await bots.setCount(1);
    // This is the real movement path: setLinearWalkDir calls
    // BotDriver.setModeWithConfig('linear-walk', {direction:{x:0,z:1}}).
    // Each tick thereafter: linearWalkStrategy.computeIntent() → {x:0,z:1}
    // → movement.walk({x:0,z:1}, yaw, dt) → BotCharacterMovement → Rapier.
    bots.setLinearWalkDir(0, { x: 0, z: 1 });
  });

  // 5. Wait deterministically for the map's layout geometry to reach the store.
  //    Task-13 wires useMapPicker to load layouts for baked-only rooms and pass
  //    them to compileMap. The compiled 16 corridor instances are broadcast via
  //    the in-memory channel → bot's SyncEngine → BotPhysicsWorld.syncCubes.
  //    Polling here instead of a fixed sleep ensures the bot has its floor
  //    colliders before we place it, without the fragile 3 s timing window.
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
    CORRIDOR_INSTANCE_COUNT,
    { timeout: 20_000, polling: 200 },
  );

  // 6. Teleport bot to the corridor spawn point and configure the spawnList.
  //
  //    scenario-corridor.json spawn point is {x:0, y:0, z:0} (y=0 is honest:
  //    the KCC resolves the body upward from inside the platform on the first
  //    physics step, settling at y≈1.5).
  //
  //    pickRespawnPosition adds SPAWN_DROP_HEIGHT=4 → fall-respawn drops from y=4.
  //    At y=4, velY=-8 fires at body.y≈2.4; floor (y=2) IS within FLOOR_PROBE_RANGE=2
  //    → hasFloorUnderneath=true → dual-gate NOT met → bot lands normally at y≈1.5.
  //
  //    Compare: if spawnList.y=2, pickRespawnPosition → y=6. At body.y≈4.4,
  //    floor (y=2) is NOT in the 2m probe range → dual-gate fires AGAIN
  //    → infinite respawn loop.
  await page.evaluate(() => {
    const bots = (
      window as unknown as {
        __OFFICE_BOTS__?: {
          respawnAll: (spawns: ReadonlyArray<{ x: number; y: number; z: number }>) => void;
        };
      }
    ).__OFFICE_BOTS__;
    if (!bots) throw new Error('__OFFICE_BOTS__ not available');
    // y=0 matches the authored spawn in scenario-corridor.json.
    // SPAWN_DROP_HEIGHT=4 → fall-respawn drops from y=4; floor found within probe range.
    bots.respawnAll([{ x: 0, y: 0, z: 0 }]);
  });

  // Brief settle — let the physics step fire after the teleport.
  await page.waitForTimeout(500);

  // Confirm bot-001 appears in the store before proceeding.
  await page.waitForFunction(
    (id: string) => {
      const w = window as unknown as {
        __OFFICE_STORE__?: {
          getState: () => { players: Record<string, unknown> };
        };
      };
      return Boolean(w.__OFFICE_STORE__?.getState().players[id]);
    },
    BOT_ID,
    { timeout: 15_000, polling: 200 },
  );

  // ------------------------------------------------------------------
  // Phase 1 — Settled on platform + walking forward
  // ------------------------------------------------------------------

  // Phase 1: Wait for bot to settle on the platform surface near the start.
  // Condition: settled y≈1.5, vel.y≈0, and z < 5 (still early in the corridor).
  // At walkSpeed≈3 m/s the bot reaches z=5 in ~1.7s, so this fires early in the run.
  // NOTE: predicates are serialised to the browser — no node-side variables allowed.
  await waitForBotCondition(
    page,
    BOT_ID,
    (pos, vel) =>
      Math.abs(pos.y - 1.5) < 0.3 && Math.abs(vel.y) < 0.1 && pos.z < 5,
    15_000,
  );

  // ------------------------------------------------------------------
  // Phase 2 — Walking along corridor: walk() verb produces real movement
  // ------------------------------------------------------------------

  // Measure z progress over 3 s. The bot is near the start of the corridor
  // (z < 5), so it has at least 11 m of runway before the far edge (z=16).
  // Over 3 s at ~3 m/s it advances ~9 m (well past the 1 m threshold).
  const startZ = await getBotZ(page, BOT_ID);
  await page.waitForTimeout(3_000);
  const midZ = await getBotZ(page, BOT_ID);
  expect(
    midZ,
    `bot moved at least 1 m in +Z over 3 s (startZ=${startZ.toFixed(2)}, midZ=${midZ.toFixed(2)})`,
  ).toBeGreaterThan(startZ + 1.0);

  // Keyframe 1: bot on platform, past midpoint (manifest condition: z ≥ 6).
  await waitForBotCondition(
    page,
    BOT_ID,
    (pos) => pos.z >= 6 && Math.abs(pos.y - 1.5) < 0.35,
    15_000,
  );

  await captureMotionKeyframe(page, 'keyframe-01-on-platform.png', {
    committed: true,
    maxDiffPixelRatio: MANIFEST.assertionThresholds.keyframePixelDiffPercent,
  });

  // ------------------------------------------------------------------
  // Phase 3 — Fall detected (bot walks off corridor far edge)
  // ------------------------------------------------------------------

  // Step 3a: Wait for the bot to reach the far edge of the corridor (pos.z > 15).
  // At z≈16 the corridor ends and the bot steps into free fall.
  // Literal 15.0 (predicate is serialised to browser — no node variables).
  await waitForBotCondition(
    page,
    BOT_ID,
    (pos) => pos.z > 15.0,
    20_000,
  );

  // Step 3b: Assert the fall velocity-vector (vel.y <= -4 m/s) via the observer store.
  //
  // Background on vel.y observability:
  //   BotCharacterMovement.broadcastVel internally sets y=0 — the internal Rapier
  //   velY accumulator is not propagated directly. HOWEVER, PositionBroadcaster
  //   (packages/sdk/src/realtime/outbound/position-broadcaster.ts) overwrites
  //   the broadcast vel with a position-delta estimate:
  //     vel.y = (pos.y_new − pos.y_old) × 1000 / dt_ms
  //   During free fall the bot's Y drops significantly between broadcasts
  //   (at 30 Hz: ~33 ms dt, ~9.8 m/s² gravity → ~0.16 m/step → ~4.8 m/s estimate).
  //   So __OFFICE_STORE__.getState().players[id].vel.y IS strongly negative
  //   while the bot is falling — the observer sees the delta-estimated velocity.
  //
  // Threshold −4: matches the manifest's keyframe-02 condition. The delta estimate
  // may not reach the full internal accumulator value (−8 m/s) because the
  // broadcaster fires at ~30 Hz (rate-limited), but −4 m/s is reliably observable.
  // Polling at 50 ms (tighter than default 100 ms) to catch the brief fall window.
  //
  // PRD requirement S1 #3: assert the downward velocity VECTOR, not just position.
  // Literal -4 in the predicate (serialised to browser — no node-side variables).
  // waitForBotCondition IS the velocity-vector assertion: it only resolves when
  // the predicate returns true (vel.y <= -4) for a poll that completed successfully.
  // If it times out, the test fails with the last-observed vel.y in the error message.
  //
  // A separate getBotState + expect AFTER this wait is NOT safe: the fall lasts ~0.3 s
  // and by the time getBotState runs, the bot may have landed and vel.y may have
  // recovered to ~0. The async gap between waitForBotCondition returning and the next
  // getBotState call is enough to miss the fall window (demonstrated in combined runs).
  //
  // The velocity assertion is: this wait resolving = vel.y <= -4 was observed.
  // A timeout at 5 s = vel.y never reached -4 = assertion failure.
  await waitForBotCondition(
    page,
    BOT_ID,
    (_pos, vel) => vel.y <= -4,
    // 5 s budget: after pos.z > 15, the bot falls immediately. The fall duration
    // before respawn is ~0.3 s. If we don't see vel.y <= -4 within 5 s, either
    // the broadcaster is suppressing the delta or the fall is too brief to observe.
    5_000,
    50, // 50 ms polling — tight interval to catch the brief fall window
  );
  // If we reach here, vel.y <= -4 was confirmed in the store during the fall window.
  // PRD S1 #3 — downward velocity vector assertion — is satisfied.

  // Keyframe 2: bot at far end of corridor / entering fall zone.
  // Captured after the vel.y assertion fires. The 200 ms settle inside
  // captureMotionKeyframe is longer than the fall (~0.3 s), so by the time
  // the screenshot is taken the bot may have already respawned (documented in
  // task-10 notes: keyframe-02 shows bot at spawn end in falling/airborne pose).
  await captureMotionKeyframe(page, 'keyframe-02-falling.png', {
    committed: true,
    maxDiffPixelRatio: MANIFEST.assertionThresholds.keyframePixelDiffPercent,
  });

  // ------------------------------------------------------------------
  // Phase 4 — Respawn fires (dual-gate rule wired through CharacterMovement)
  // ------------------------------------------------------------------

  // After shouldRespawnFalling() fires, BotDriver.tick() calls
  // movement.teleport(pickRespawnPosition(spawnList)).
  // pickRespawnPosition adds SPAWN_DROP_HEIGHT=4:
  //   spawnList[0] = {x:0,y:0,z:0} → respawn pos = {x:0,y:4,z:0}
  // The bot is teleported to y=4, then falls and settles at y≈1.5, z≈0.
  //
  // Wait for the respawn teleport itself: pos.z < 1 AND pos.y > 3.5 (bot is in
  // the air at the respawn drop point). This state exists for ~0.1-0.3 s and is
  // the most direct proof that pickRespawnPosition fired. 100ms polling catches it.
  // Literal values only (predicates are serialised to browser).
  await waitForBotCondition(
    page,
    BOT_ID,
    (pos) => pos.z < 1.0 && pos.y > 3.5,
    20_000,
  );

  // Full settle at spawn: body.y ≈ 1.5 (settled on platform top).
  // vel.y is always 0 in broadcastVel — use pos.y proximity as the settle gate.
  await waitForBotCondition(
    page,
    BOT_ID,
    (pos) => pos.z < 4 && Math.abs(pos.y - 1.5) < 0.3,
    10_000,
  );

  // ------------------------------------------------------------------
  // Final numeric assertions (before keyframe 3 to avoid walking drift)
  // ------------------------------------------------------------------

  // Capture the post-respawn state IMMEDIATELY after the settle condition
  // fires — while the bot is still at z < 2. The bot continues walking after
  // this (it's in linear-walk mode), so measuring after captureMotionKeyframe
  // (which includes a 200ms pause) would see the bot at a higher z.
  const finalState = await getBotState(page, BOT_ID);
  expect(finalState, 'bot-001 found in store after respawn').not.toBeNull();

  const finalPos = finalState!.pos;
  expect(
    Math.abs(finalPos.y - 1.5),
    `final pos.y (${finalPos.y.toFixed(3)}) must be within 0.3m of 1.5 (settled on platform)`,
  ).toBeLessThan(0.3);

  expect(
    finalPos.z,
    `final pos.z (${finalPos.z.toFixed(3)}) must be < 4 (near spawn end of corridor)`,
  ).toBeLessThan(4);

  // Keyframe 3: bot settled at spawn after respawn (captured after assertions
  // to match the visual state at the time of final numeric checks).
  await captureMotionKeyframe(page, 'keyframe-03-respawned.png', {
    committed: true,
    maxDiffPixelRatio: MANIFEST.assertionThresholds.keyframePixelDiffPercent,
  });
});
