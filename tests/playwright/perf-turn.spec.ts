/**
 * Camera-path performance scenario, run on demand and by the perf-ab workflow:
 *
 *   pnpm exec playwright test -c playwright.perf.config.ts
 *
 * In each of Bird's-eye, Angled, Free look and First person it walks a square, turns a full circle and
 * orbits, in the `full` HUD-preview scenario (a crowd of players on the default map) at 1280x800, and
 * writes p50/p95 frame ms, 1% low fps, stalls (frames over 2x 16.7 ms), draw calls and triangles per frame (counted at the GL API) to
 * `$PERF_OUT` (default `test-results/perf-turn.json`).
 *
 * Software WebGL makes the absolute numbers meaningless and noisy. Compare two runs on the same machine
 * (scripts/perf/compare.mjs); this spec asserts nothing about speed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { summarizeFrames, type ModeStats } from './lib/perfStats.ts';

test.describe.configure({ timeout: 600_000 });

const BASE = process.env.HUD_BASE_URL ?? 'http://localhost:5176';
const OUT = process.env.PERF_OUT ?? 'test-results/perf-turn.json';
const PHASE_MS = Number(process.env.PERF_PHASE_MS ?? 3000);
const MODES = ['birds-eye', 'angled', 'free-look', 'first-person'] as const;
type Mode = (typeof MODES)[number];
const LOOK_MODES: readonly Mode[] = ['free-look', 'first-person'];
const VIEWPORT = { width: 1280, height: 800 };
const FULL_TURN_PX = Math.round((2 * Math.PI) / 0.0025);
const STEP_MS = 50;

const results: Partial<Record<Mode, ModeStats>> = {};

async function open(page: Page, mode: Mode): Promise<void> {
  await page.addInitScript((view) => {
    localStorage.setItem('officexr:gameView', view);
    localStorage.setItem('officexr:appearance', 'light');
    for (const n of ['move', 'people', 'wave', 'alone', 'build']) localStorage.setItem(`officexr:hint:${n}`, 'done');
    const w = window as unknown as { __frames: number[]; __record: boolean; __draws: number; __tris: number };
    w.__frames = [];
    w.__record = false;
    w.__draws = 0;
    w.__tris = 0;
    // Counted at the GL API so the same spec measures a base checkout that has no stats readout.
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
    let last = performance.now();
    const tick = (t: number) => {
      if (w.__record) w.__frames.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, mode);
  await page.goto(`${BASE}/hud-preview?scenario=full`);
  await page.getByRole('button', { name: 'Office menu' }).first().waitFor({ timeout: 120_000 });
  await page.waitForTimeout(4000);
}

async function holdKey(page: Page, keys: string[], ms: number): Promise<void> {
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  for (const k of keys) await page.keyboard.up(k);
}

async function walkSquare(page: Page): Promise<void> {
  for (const k of ['w', 'd', 's', 'a']) await holdKey(page, [k], PHASE_MS / 4);
}

async function sweep(page: Page, totalPx: number, moveKey?: string): Promise<void> {
  const at = { x: Math.round(VIEWPORT.width * 0.6), y: Math.round(VIEWPORT.height * 0.4) };
  const steps = Math.round(PHASE_MS / STEP_MS);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down({ button: 'right' });
  if (moveKey) await page.keyboard.down(moveKey);
  for (let i = 0; i < steps; i++) {
    await page.evaluate(
      ([x, y, dx]) => document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, movementX: dx, bubbles: true })),
      [at.x, at.y, totalPx / steps] as const,
    );
    await page.waitForTimeout(STEP_MS);
  }
  if (moveKey) await page.keyboard.up(moveKey);
  await page.mouse.up({ button: 'right' });
}

async function spinInPlace(page: Page, mode: Mode): Promise<void> {
  if (LOOK_MODES.includes(mode)) return sweep(page, FULL_TURN_PX);
  const keys = ['w', 'd', 's', 'a'];
  for (let i = 0; i < Math.round(PHASE_MS / 150); i++) await holdKey(page, [keys[i % 4]!], 150);
}

async function orbit(page: Page, mode: Mode): Promise<void> {
  if (LOOK_MODES.includes(mode)) return sweep(page, FULL_TURN_PX, 'w');
  for (const combo of [['w', 'd'], ['d', 's'], ['s', 'a'], ['a', 'w']]) await holdKey(page, combo, PHASE_MS / 4);
}

for (const mode of MODES) {
  test(`camera path in ${mode}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await context.newPage();
    try {
      await open(page, mode);
      await page.evaluate(() => {
        const w = window as unknown as { __frames: number[]; __record: boolean; __draws: number; __tris: number };
        w.__frames.length = 0;
        w.__draws = 0;
        w.__tris = 0;
        w.__record = true;
      });
      await walkSquare(page);
      await spinInPlace(page, mode);
      await orbit(page, mode);
      const { frames, draws, tris } = await page.evaluate(() => {
        const w = window as unknown as { __frames: number[]; __record: boolean; __draws: number; __tris: number };
        w.__record = false;
        return { frames: w.__frames.slice(), draws: w.__draws, tris: w.__tris };
      });
      const perFrame = Math.max(1, frames.length);
      results[mode] = summarizeFrames(frames, Math.round(draws / perFrame), Math.round(tris / perFrame));
      console.log(`${mode}: ${JSON.stringify(results[mode])}`);
    } finally {
      await context.close();
    }
  });
}

test.afterAll(() => {
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ viewport: VIEWPORT, phaseMs: PHASE_MS, scenario: 'full', modes: results }, null, 2));
});
