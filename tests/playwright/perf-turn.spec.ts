/**
 * Camera-path performance scenario, run on demand and by the perf-ab workflow:
 *
 *   pnpm --filter @officexr/web exec vite build --config vite.hud-preview.config.ts --configLoader runner
 *   pnpm exec playwright test -c playwright.perf.config.ts
 *
 * Runs against the production build of the `full` HUD-preview scenario (a crowd of players on the default
 * map) at 480x300. In each of Bird's-eye, Angled, Free look and First person it walks a square, turns a
 * full circle and orbits. Every phase lasts a fixed number of rendered frames, not a fixed time.
 *
 * Per mode it writes to `$PERF_OUT` (default `test-results/perf-turn.json`):
 *  - main-thread script and task ms per rendered frame (CDP Performance.getMetrics), the primary metric;
 *  - React commits per second, counted through the React DevTools global hook (a stub injected before the
 *    page loads, so it works on any checkout and needs no app code);
 *  - draw calls and triangles per frame, counted at the GL API;
 *  - wall-clock fps, for information only: CI has no GPU and renders with software WebGL.
 *
 * With PERF_COMPONENTS=1 against a build made with HUD_PROFILING=1 it also writes per component renders
 * and self ms per phase. Entries named `(starts X)` count the commits whose update began at X, and
 * `(commit dom|r3f)` the commits per React root kind.
 *
 * This spec asserts nothing about speed. Compare two runs on one machine with scripts/perf/compare.mjs.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, type CDPSession, type Page } from '@playwright/test';
import { summarizeMode, type ModeStats, type PhaseSample } from './lib/perfStats.ts';
import { COMPONENT_PROBE } from './lib/componentProbe.ts';

test.describe.configure({ timeout: 600_000 });

const BASE = process.env.HUD_BASE_URL ?? `http://localhost:${process.env.HUD_PORT ?? 5176}`;
const OUT = process.env.PERF_OUT ?? 'test-results/perf-turn.json';
const PHASE_FRAMES = Number(process.env.PERF_PHASE_FRAMES ?? 20);
const COMPONENTS = process.env.PERF_COMPONENTS === '1';
const MODES = ['birds-eye', 'angled', 'free-look', 'first-person'] as const;
type Mode = (typeof MODES)[number];
const LOOK_MODES: readonly Mode[] = ['free-look', 'first-person'];
const VIEWPORT = { width: 480, height: 300 };
const FULL_TURN_PX = Math.round((2 * Math.PI) / 0.0025);
const SEGMENT_TIMEOUT_MS = 30_000;

const results: Partial<Record<Mode, ModeStats>> = {};
const components: Partial<Record<Mode, unknown>> = {};

type PerfWindow = Window & {
  __n: number;
  __record: boolean;
  __draws: number;
  __tris: number;
  __commits: number;
  __componentsReset?: () => void;
  __componentsRead?: () => unknown;
};

async function open(page: Page, mode: Mode): Promise<void> {
  await page.addInitScript(
    ([view, probe]) => {
      localStorage.setItem('officexr:gameView', view!);
      localStorage.setItem('officexr:appearance', 'light');
      for (const n of ['move', 'people', 'wave', 'alone', 'build']) localStorage.setItem(`officexr:hint:${n}`, 'done');
      const w = window as unknown as PerfWindow;
      w.__n = 0;
      w.__record = false;
      w.__draws = 0;
      w.__tris = 0;
      w.__commits = 0;
      const onCommit = probe ? (0, eval)(probe) : null;
      let nextId = 1;
      (window as unknown as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true,
        renderers: new Map(),
        inject: () => nextId++,
        checkDCE: () => {},
        onScheduleFiberRoot: () => {},
        onCommitFiberUnmount: () => {},
        onPostCommitFiberRoot: () => {},
        onCommitFiberRoot: (_id: number, root: unknown) => {
          if (!w.__record) return;
          w.__commits++;
          if (onCommit) onCommit(root, w);
        },
      };
      const TRIANGLES = 4;
      for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
        const p = proto as unknown as Record<string, (...a: number[]) => unknown>;
        const count = (name: string, perDraw: (a: number[]) => number) => {
          const orig = p[name];
          if (!orig) return;
          p[name] = function (this: unknown, ...a: number[]) {
            if (w.__record) {
              w.__draws++;
              if (a[0] === TRIANGLES) w.__tris += perDraw(a);
            }
            return orig.apply(this, a);
          };
        };
        count('drawArrays', (a) => a[2]! / 3);
        count('drawElements', (a) => a[1]! / 3);
        count('drawArraysInstanced', (a) => (a[2]! / 3) * a[3]!);
        count('drawElementsInstanced', (a) => (a[1]! / 3) * a[4]!);
      }
      const tick = () => {
        if (w.__record) w.__n++;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    [mode, COMPONENTS ? COMPONENT_PROBE : ''] as const,
  );
  await page.goto(`${BASE}/hud-preview?scenario=full`);
  await page.getByRole('button', { name: 'Office menu' }).first().waitFor({ timeout: 120_000 });
  await page.waitForTimeout(3000);
}

async function waitFrames(page: Page, frames: number): Promise<void> {
  await page.evaluate(
    ([k, timeout]) =>
      new Promise<void>((resolve) => {
        const w = window as unknown as PerfWindow;
        const target = w.__n + k!;
        const giveUp = performance.now() + timeout!;
        const poll = () => (w.__n >= target || performance.now() > giveUp ? resolve() : requestAnimationFrame(poll));
        poll();
      }),
    [frames, SEGMENT_TIMEOUT_MS] as const,
  );
}

async function holdKeys(page: Page, keys: string[], frames: number): Promise<void> {
  for (const k of keys) await page.keyboard.down(k);
  await waitFrames(page, frames);
  for (const k of keys) await page.keyboard.up(k);
}

async function sweep(page: Page, frames: number, moveKey?: string): Promise<void> {
  const at = { x: Math.round(VIEWPORT.width * 0.6), y: Math.round(VIEWPORT.height * 0.4) };
  const framesPerStep = 2;
  const steps = Math.max(1, Math.round(frames / framesPerStep));
  await page.mouse.move(at.x, at.y);
  await page.mouse.down({ button: 'right' });
  if (moveKey) await page.keyboard.down(moveKey);
  for (let i = 0; i < steps; i++) {
    await page.evaluate(
      ([x, y, dx]) => document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, movementX: dx, bubbles: true })),
      [at.x, at.y, FULL_TURN_PX / steps] as const,
    );
    await waitFrames(page, framesPerStep);
  }
  if (moveKey) await page.keyboard.up(moveKey);
  await page.mouse.up({ button: 'right' });
}

const walkSquare = async (page: Page) => {
  for (const k of ['w', 'd', 's', 'a']) await holdKeys(page, [k], PHASE_FRAMES / 4);
};

async function spinInPlace(page: Page, mode: Mode): Promise<void> {
  if (LOOK_MODES.includes(mode)) return sweep(page, PHASE_FRAMES);
  const keys = ['w', 'd', 's', 'a'];
  const segment = 4;
  for (let i = 0; i < Math.round(PHASE_FRAMES / segment); i++) await holdKeys(page, [keys[i % 4]!], segment);
}

async function orbit(page: Page, mode: Mode): Promise<void> {
  if (LOOK_MODES.includes(mode)) return sweep(page, PHASE_FRAMES, 'w');
  for (const combo of [['w', 'd'], ['d', 's'], ['s', 'a'], ['a', 'w']]) await holdKeys(page, combo, PHASE_FRAMES / 4);
}

const cpuMetrics = async (cdp: CDPSession) => {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const get = (name: string) => metrics.find((m) => m.name === name)?.value ?? 0;
  return { script: get('ScriptDuration') * 1000, task: get('TaskDuration') * 1000 };
};

async function measure(page: Page, cdp: CDPSession, run: () => Promise<void>): Promise<PhaseSample> {
  await page.evaluate(() => {
    const w = window as unknown as PerfWindow;
    w.__n = 0;
    w.__draws = 0;
    w.__tris = 0;
    w.__commits = 0;
    w.__componentsReset?.();
    w.__record = true;
  });
  const cpu0 = await cpuMetrics(cdp);
  const t0 = Date.now();
  await run();
  const wallMs = Date.now() - t0;
  const cpu1 = await cpuMetrics(cdp);
  const counts = await page.evaluate(() => {
    const w = window as unknown as PerfWindow;
    w.__record = false;
    return { frames: w.__n, draws: w.__draws, tris: w.__tris, commits: w.__commits, components: w.__componentsRead?.() ?? null };
  });
  const { components: perComponent, ...rest } = counts;
  if (perComponent) (components as Record<string, Record<string, unknown>>)[currentMode] = { ...(components[currentMode] as object), [currentPhase]: perComponent };
  return { ...rest, frames: Math.max(1, rest.frames), wallMs, scriptMs: cpu1.script - cpu0.script, taskMs: cpu1.task - cpu0.task };
}

let currentMode: Mode = 'birds-eye';
let currentPhase = '';

for (const mode of MODES) {
  test(`camera path in ${mode}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await context.newPage();
    try {
      currentMode = mode;
      await open(page, mode);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      const phases: Record<string, PhaseSample> = {};
      for (const [name, run] of [
        ...(COMPONENTS ? ([['idle', () => waitFrames(page, PHASE_FRAMES)]] as const) : []),
        ['walk', () => walkSquare(page)],
        ['turn', () => spinInPlace(page, mode)],
        ['orbit', () => orbit(page, mode)],
      ] as const) {
        currentPhase = name;
        phases[name] = await measure(page, cdp, run);
      }
      results[mode] = summarizeMode(phases);
      const { phases: _phases, ...headline } = results[mode]!;
      console.log(`${mode}: ${JSON.stringify(headline)}`);
    } finally {
      await context.close();
    }
  });
}

test.afterAll(() => {
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ viewport: VIEWPORT, phaseFrames: PHASE_FRAMES, scenario: 'full', modes: results }, null, 2));
  if (COMPONENTS) writeFileSync(OUT.replace(/\.json$/, '.components.json'), JSON.stringify(components, null, 2));
});
