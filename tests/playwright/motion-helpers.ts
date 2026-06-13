/**
 * motion-helpers.ts — Shared Playwright utilities for motion scenario specs.
 *
 * Analogous to helpers.ts but focused on motion scenarios: driving bots via
 * the `__OFFICE_BOTS__` window hook, polling bot state from `__OFFICE_STORE__`,
 * and capturing keyframe PNGs for baseline comparison.
 *
 * The committed regression gate for every motion scenario spec is:
 *   1. Numeric assertions via `waitForBotCondition` (pos + vel from the store).
 *   2. Keyframe PNGs via `captureMotionKeyframe` compared against committed
 *      ideals in `motion-baselines/<scenario>/ideal/` using Playwright's
 *      `toHaveScreenshot()`.
 *
 * No `import * as THREE` — helpers are headless, no renderer imports.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Page, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 3-component world-space vector. Mirrors `Vec3` from `@officexr/sdk`. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A single keyframe entry from a scenario manifest.json. */
export interface MotionKeyframe {
  id: string;
  filename: string;
  captureCondition: string;
  description: string;
}

/** Assertion thresholds from the manifest. */
export interface AssertionThresholds {
  /** Allowed position error in metres. */
  positionTolerance: number;
  /** Allowed velocity error in m/s. */
  velocityTolerance: number;
  /** Fraction of pixels allowed to differ between keyframe PNG snapshots. */
  keyframePixelDiffPercent: number;
}

/** Parsed content of a `motion-baselines/<scenario>/manifest.json` file. */
export interface MotionManifest {
  scenario: string;
  description: string;
  geometry: string;
  /** Primary spawn point (used by single-bot scenarios). */
  spawnPoint?: Vec3;
  /** Multiple spawn points (used by multi-bot scenarios, e.g. collision). */
  spawnPoints?: Array<{ id: string } & Vec3 & { description?: string }>;
  keyframes: MotionKeyframe[];
  assertionThresholds: AssertionThresholds;
}

// ---------------------------------------------------------------------------
// Manifest reader
// ---------------------------------------------------------------------------

const MOTION_BASELINES_ROOT = path.join(
  __dirname,
  'motion-baselines',
);

/**
 * Read and parse a scenario's `manifest.json` from
 * `tests/playwright/motion-baselines/<scenario>/manifest.json`.
 *
 * Throws a descriptive error if the file is missing or malformed, so a spec
 * calling this at the top level fails immediately with a clear message rather
 * than a downstream undefined-property error.
 */
export function readMotionManifest(scenario: string): MotionManifest {
  const manifestPath = path.join(MOTION_BASELINES_ROOT, scenario, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `readMotionManifest: no manifest found at ${manifestPath}. ` +
        `Create motion-baselines/${scenario}/manifest.json before running the spec.`,
    );
  }
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(raw) as MotionManifest;
  } catch (err) {
    throw new Error(
      `readMotionManifest: failed to parse ${manifestPath}: ${String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Bot state introspection
// ---------------------------------------------------------------------------

/**
 * Internal shape of the player record exposed by `__OFFICE_STORE__.getState()`.
 * Only the fields the motion helpers need — other store fields are ignored.
 */
interface PlayerRecord {
  pos: Vec3;
  vel: Vec3;
}

/**
 * Read the current pos + vel for a single player (bot or human) from the
 * SDK store. Returns `null` if the store or the player record is not yet
 * present — callers typically poll until non-null inside `waitForBotCondition`.
 *
 * Must run inside `page.evaluate()` (browser context).
 * Exported as a string so callers can compose it into `waitForFunction`
 * predicates if needed, but for most uses `waitForBotCondition` is sufficient.
 */

/**
 * Wait until a bot's pos/vel satisfies `predicate`.
 *
 * Polls `__OFFICE_STORE__.getState().players[botId]` every `pollingMs`
 * milliseconds. Rejects with a descriptive timeout error that includes the
 * last-observed pos and vel so failures are self-diagnosing in CI.
 *
 * Pattern mirrors `page.waitForFunction` from `debug-character-grounded.spec.ts`
 * but extracted as a reusable helper so scenario specs stay readable.
 *
 * @param page       Playwright Page.
 * @param botId      PlayerId in the SDK store, e.g. `"bot-001"`.
 * @param predicate  Pure function (serialised and executed in browser context)
 *                   that receives `{pos, vel}` and returns `true` when the
 *                   condition is met. Must be serialisable (no closures over
 *                   node-side variables).
 * @param timeoutMs  Maximum time to wait before rejecting. Default 15 s.
 * @param pollingMs  Poll interval. Default 100 ms.
 */
export async function waitForBotCondition(
  page: Page,
  botId: string,
  predicate: (pos: Vec3, vel: Vec3) => boolean,
  timeoutMs = 15_000,
  pollingMs = 100,
): Promise<void> {
  // Serialise the predicate to a source string and reconstruct it in the
  // browser so it can reference `pos`/`vel` directly. Playwright's
  // `waitForFunction` does this automatically when passed a function, but
  // we need to pass `botId` as a parameter so we use the explicit arg form.
  try {
    await page.waitForFunction(
      ({
        id,
        predicateSrc,
        polling,
      }: {
        id: string;
        predicateSrc: string;
        polling: number;
      }) => {
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
        if (!w.__OFFICE_STORE__) return false;
        const player = w.__OFFICE_STORE__.getState().players[id];
        if (!player) return false;
        // eslint-disable-next-line no-new-func
        const fn = new Function('pos', 'vel', `return (${predicateSrc})(pos, vel)`) as (
          pos: { x: number; y: number; z: number },
          vel: { x: number; y: number; z: number },
        ) => boolean;
        return fn(player.pos, player.vel);
      },
      { id: botId, predicateSrc: predicate.toString(), polling: pollingMs },
      { timeout: timeoutMs, polling: pollingMs },
    );
  } catch {
    // Fetch last-observed state for a self-diagnosing timeout error.
    const lastState = await page.evaluate((id: string) => {
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
      const player = w.__OFFICE_STORE__?.getState().players[id];
      return player
        ? { pos: player.pos, vel: player.vel }
        : null;
    }, botId);

    throw new Error(
      `waitForBotCondition(${botId}) timed out after ${timeoutMs} ms.\n` +
        `Last observed state: ${JSON.stringify(lastState)}\n` +
        `Predicate: ${predicate.toString()}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Keyframe capture
// ---------------------------------------------------------------------------

/**
 * Options for `captureMotionKeyframe`.
 */
export interface CaptureMotionKeyframeOptions {
  /**
   * When `true` (default), uses Playwright's `toHaveScreenshot()` to
   * compare against the committed baseline in the spec's snapshot directory.
   * Pass `maxDiffPixelRatio` from the manifest's
   * `assertionThresholds.keyframePixelDiffPercent`.
   *
   * When `false`, captures a screenshot to `outputDir` for human review
   * without an assertion — useful for initial baseline generation.
   */
  committed?: boolean;
  /**
   * Maximum fraction of pixels that may differ from the committed baseline.
   * Only used when `committed === true`. Defaults to 0.02 (2%).
   * Set this from the manifest's `assertionThresholds.keyframePixelDiffPercent`.
   */
  maxDiffPixelRatio?: number;
  /**
   * Directory for non-committed captures (`committed === false`). Defaults to
   * `test-results/motion-captures/`. Ignored when `committed === true`.
   */
  outputDir?: string;
}

/**
 * Capture a canvas keyframe screenshot and either assert against a committed
 * baseline (default) or save for human review.
 *
 * **Committed mode** (`committed: true`, the default):
 *   Calls `expect(page).toHaveScreenshot(snapshotName, { maxDiffPixelRatio })`.
 *   Playwright writes `<spec>.spec.ts-snapshots/<snapshotName>` on first run
 *   (`--update-snapshots`) and asserts within tolerance on subsequent runs.
 *   The `maxDiffPixelRatio` should come from the manifest's
 *   `assertionThresholds.keyframePixelDiffPercent`.
 *
 * **Non-committed mode** (`committed: false`):
 *   Saves to `outputDir/<snapshotName>` for human review without any
 *   assertion. Useful when generating the first set of baselines.
 *
 * Targets the canvas element only (same pattern as `character-on-surface.spec.ts`)
 * so surrounding UI chrome does not contribute to the diff.
 *
 * @param page         Playwright Page.
 * @param snapshotName Filename for the screenshot, e.g. `"keyframe-01-on-platform.png"`.
 * @param options      See `CaptureMotionKeyframeOptions`.
 */
export async function captureMotionKeyframe(
  page: Page,
  snapshotName: string,
  options: CaptureMotionKeyframeOptions = {},
): Promise<void> {
  const {
    committed = true,
    maxDiffPixelRatio = 0.02,
    outputDir = 'test-results/motion-captures',
  } = options;

  // Settle a few frames so the R3F render loop has flushed any pending
  // state changes before we capture. Mirrors the 400 ms beat used by
  // character-on-surface.spec.ts after the numeric settle assertion.
  await page.waitForTimeout(200);

  if (committed) {
    // Target the canvas only — surrounding control-panel layout changes
    // must not break keyframe baselines. Matches character-on-surface.spec.ts.
    const canvas = page.locator('canvas').first();
    await expect(canvas).toHaveScreenshot(snapshotName, {
      maxDiffPixelRatio,
      animations: 'disabled',
    });
  } else {
    // Non-committed: save to outputDir for human inspection.
    const canvas = page.locator('canvas').first();
    const buf = await canvas.screenshot({ type: 'png' });
    fs.mkdirSync(outputDir, { recursive: true });
    const outPath = path.join(outputDir, snapshotName);
    fs.writeFileSync(outPath, buf);
    console.log(`captureMotionKeyframe: saved (non-committed) ${outPath}`);
  }
}

// ---------------------------------------------------------------------------
// Bot pool helpers
// ---------------------------------------------------------------------------

/**
 * Shape of the `__OFFICE_BOTS__` window hook exposed by `DebugApp.tsx`
 * (in-memory stack only). Mirrors the `BotPool` public API surface used
 * by tests — intentionally a minimal subset so the type stays stable as
 * BotPool evolves.
 */
export interface OfficeBotHook {
  setCount(n: number): Promise<void>;
  setMode(mode: string): void;
  respawnAll(spawns: ReadonlyArray<{ x: number; y: number; z: number }>): void;
}

/**
 * Wait until `__OFFICE_BOTS__` is published on `window` (by DebugApp's
 * in-memory stack mount) and return the typed hook.
 *
 * Scenario specs call this after `waitForCanvasReady` to obtain the
 * hook before driving bots. The hook is absent before the in-memory
 * stack initialises (typically a few hundred ms after canvas mount).
 *
 * @param page      Playwright Page.
 * @param timeoutMs Maximum wait time. Default 15 s.
 */
export async function waitForBotsHook(
  page: Page,
  timeoutMs = 15_000,
): Promise<void> {
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __OFFICE_BOTS__?: unknown })
        .__OFFICE_BOTS__ === 'object' &&
      (window as unknown as { __OFFICE_BOTS__?: unknown }).__OFFICE_BOTS__ !==
        null,
    null,
    { timeout: timeoutMs },
  );
}

/**
 * Set the number of active bots via `__OFFICE_BOTS__.setCount(n)`.
 *
 * Convenience wrapper that serialises the call into `page.evaluate` and
 * awaits the promise BotPool returns (which resolves after all spawns or
 * teardowns complete). Call `waitForBotsHook` first.
 *
 * @param page  Playwright Page.
 * @param count Target bot count.
 */
export async function setBotCount(page: Page, count: number): Promise<void> {
  await page.evaluate(async (n: number) => {
    const bots = (
      window as unknown as { __OFFICE_BOTS__?: { setCount: (n: number) => Promise<void> } }
    ).__OFFICE_BOTS__;
    if (!bots) throw new Error('__OFFICE_BOTS__ not available');
    await bots.setCount(n);
  }, count);
}

/**
 * Set the mode for all active bots via `__OFFICE_BOTS__.setMode(mode)`.
 *
 * Call `waitForBotsHook` first.
 *
 * @param page Playwright Page.
 * @param mode BotMode string, e.g. `"linear-walk"`, `"idle"`.
 */
export async function setBotMode(page: Page, mode: string): Promise<void> {
  await page.evaluate((m: string) => {
    const bots = (
      window as unknown as { __OFFICE_BOTS__?: { setMode: (mode: string) => void } }
    ).__OFFICE_BOTS__;
    if (!bots) throw new Error('__OFFICE_BOTS__ not available');
    bots.setMode(m);
  }, mode);
}

/**
 * Teleport all bots to known spawn positions via `__OFFICE_BOTS__.respawnAll(spawns)`.
 *
 * Bot indices cycle through the `spawns` array modulo its length (BotPool
 * invariant). For a two-bot scenario with two spawn points, bot-001 gets
 * `spawns[0]` and bot-002 gets `spawns[1]`.
 *
 * Call `waitForBotsHook` first.
 *
 * @param page   Playwright Page.
 * @param spawns World-space positions to respawn bots to.
 */
export async function respawnBots(
  page: Page,
  spawns: ReadonlyArray<{ x: number; y: number; z: number }>,
): Promise<void> {
  await page.evaluate(
    (s: ReadonlyArray<{ x: number; y: number; z: number }>) => {
      const bots = (
        window as unknown as {
          __OFFICE_BOTS__?: {
            respawnAll: (spawns: ReadonlyArray<{ x: number; y: number; z: number }>) => void;
          };
        }
      ).__OFFICE_BOTS__;
      if (!bots) throw new Error('__OFFICE_BOTS__ not available');
      bots.respawnAll(s);
    },
    spawns,
  );
}

// ---------------------------------------------------------------------------
// Map loading
// ---------------------------------------------------------------------------

/**
 * Navigate the Debug mode to a named map by mutating `localStorage` before
 * page load (the studio reads `officexr:studio:lastMap` on boot).
 *
 * Usage in a spec:
 * ```ts
 * await goToDebugWithMap(page, 'scenario-corridor');
 * await waitForCanvasReady(page, 0, 30_000);
 * await waitForBotsHook(page);
 * ```
 *
 * Why localStorage rather than the map-picker UI? The picker requires
 * synthetic pointer events (the Radix Select hangs under GPU stalls in
 * Debug mode). Setting localStorage before navigation is simpler and more
 * reliable for test fixtures. See the `debug-mode.spec.ts` map-switch test
 * for the precedent.
 *
 * @param page    Playwright Page.
 * @param mapName Map name as it appears in `packages/world/maps/<name>.json`.
 */
export async function goToDebugWithMap(page: Page, mapName: string): Promise<void> {
  await page.addInitScript((m: string) => {
    try {
      localStorage.setItem('officexr:studio:lastMap', m);
    } catch {
      // about:blank or private mode — ignore
    }
  }, mapName);
  // `perfFooter=0` keeps the studio's perf footer out of the layout so
  // the Debug canvas viewport (and therefore every motion-keyframe
  // screenshot baseline) stays the same size it was captured at.
  await page.goto('/?perfFooter=0#debug', { waitUntil: 'domcontentloaded' });
}

/**
 * Park the LOCAL PLAYER at a fixed spot away from the bot's lane.
 *
 * Bot scenario specs share one spawn point between the local player
 * and the bot cohort: both drop onto the same coordinates at boot, and
 * how that overlap resolves is a physics race (mirror-clamp direction,
 * settle order). A bot can end up wedged behind the player — or the
 * player perched on a bot — making both trajectories AND keyframe
 * pixels nondeterministic. Parking the player deterministically before
 * the bot starts removes the race. Keyframe baselines must be captured
 * with the SAME parking spot the spec uses.
 *
 * @param pos Drop position (world coords). Should be ~1 m above the
 *   floor so gravity settles the player; pick a spot ON map geometry
 *   (off-map parking would trigger fall-respawn back to the spawn).
 */
export async function parkLocalPlayer(
  page: Page,
  pos: { x: number; y: number; z: number },
): Promise<void> {
  await page.evaluate(
    ({ pos }: { pos: { x: number; y: number; z: number } }) => {
      const w = window as unknown as {
        __OFFICE_STORE__: {
          getState: () => { selfId: string };
          setState: (updater: (s: unknown) => unknown) => void;
        };
      };
      const selfId = w.__OFFICE_STORE__.getState().selfId;
      w.__OFFICE_STORE__.setState((s: unknown) => {
        const state = s as {
          players: Record<
            string,
            { pos: unknown; vel: unknown; yaw: number } | undefined
          >;
        };
        const self = state.players[selfId];
        if (!self) return {};
        return {
          players: {
            ...state.players,
            [selfId]: {
              ...self,
              pos,
              vel: { x: 0, y: 0, z: 0 },
            },
          },
        };
      });
    },
    { pos },
  );
  // Let the auto-warp + gravity settle play out.
  await page.waitForTimeout(800);
}

// ---------------------------------------------------------------------------
// Numeric assertion helpers
// ---------------------------------------------------------------------------

/**
 * Assert that a bot's current position is within `tolerance` metres of
 * `expected` (Euclidean distance). Fails immediately with a clear message
 * that includes the actual position.
 *
 * Use after `waitForBotCondition` has confirmed the bot has reached the
 * expected region, then call this to produce a precise assertion in the
 * Playwright report.
 *
 * @param page      Playwright Page.
 * @param botId     PlayerId in the SDK store, e.g. `"bot-001"`.
 * @param expected  Expected world-space position.
 * @param tolerance Allowed Euclidean distance in metres.
 */
export async function assertBotPosition(
  page: Page,
  botId: string,
  expected: Vec3,
  tolerance: number,
): Promise<void> {
  const actual = await page.evaluate((id: string) => {
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
    return w.__OFFICE_STORE__?.getState().players[id]?.pos ?? null;
  }, botId);

  expect(actual, `bot ${botId} position: store returned null`).not.toBeNull();
  const pos = actual as Vec3;
  const dx = pos.x - expected.x;
  const dy = pos.y - expected.y;
  const dz = pos.z - expected.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  expect(
    dist,
    `bot ${botId} position ${JSON.stringify(pos)} must be within ${tolerance}m of ${JSON.stringify(expected)} — got ${dist.toFixed(3)}m`,
  ).toBeLessThanOrEqual(tolerance);
}

/**
 * Assert that a bot's current velocity is within `tolerance` m/s of
 * `expected` on each axis independently (component-wise, not Euclidean).
 * Component-wise checks produce clearer failure messages than a combined
 * magnitude check when only one axis is wrong.
 *
 * @param page      Playwright Page.
 * @param botId     PlayerId in the SDK store.
 * @param expected  Expected velocity vector (use `{x:0,y:0,z:0}` for "stationary").
 * @param tolerance Per-axis tolerance in m/s.
 */
export async function assertBotVelocity(
  page: Page,
  botId: string,
  expected: Vec3,
  tolerance: number,
): Promise<void> {
  const actual = await page.evaluate((id: string) => {
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
    return w.__OFFICE_STORE__?.getState().players[id]?.vel ?? null;
  }, botId);

  expect(actual, `bot ${botId} velocity: store returned null`).not.toBeNull();
  const vel = actual as Vec3;
  expect(
    Math.abs(vel.x - expected.x),
    `bot ${botId} vel.x (${vel.x.toFixed(3)}) must be within ${tolerance} of ${expected.x}`,
  ).toBeLessThanOrEqual(tolerance);
  expect(
    Math.abs(vel.y - expected.y),
    `bot ${botId} vel.y (${vel.y.toFixed(3)}) must be within ${tolerance} of ${expected.y}`,
  ).toBeLessThanOrEqual(tolerance);
  expect(
    Math.abs(vel.z - expected.z),
    `bot ${botId} vel.z (${vel.z.toFixed(3)}) must be within ${tolerance} of ${expected.z}`,
  ).toBeLessThanOrEqual(tolerance);
}
