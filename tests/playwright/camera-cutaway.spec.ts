import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { goToDebugWithMap } from './motion-helpers.ts';

const SHOT_DIR = process.env.OCCLUSION_SHOT_DIR;
const SHOT_PREFIX = process.env.OCCLUSION_SHOT_PREFIX ?? 'branch';

const BLOCK = 'colored_block_blue';
const HALF = 8;
const STEP = 4;
const WALL_LAYERS = [4, 8];
const ROOF_LAYER = 12;

interface Marker {
  fading: number;
  cutaway?: number;
}

async function openDefaultMap(page: Page): Promise<void> {
  await goToDebugWithMap(page, 'default');
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __OFFICE_STORE__?: { getState: () => { worldObjects?: { instances: unknown[] } } } };
      return (w.__OFFICE_STORE__?.getState().worldObjects?.instances.length ?? 0) > 0;
    },
    null,
    { timeout: 40_000 },
  );
  await page.waitForTimeout(2500);
}

async function setPitch(page: Page, pitchDeg: number): Promise<void> {
  await page.evaluate((p) => {
    const store = (window as unknown as {
      __OFFICE_STORE__: { setState: (u: (s: { worldConstants: { fixedCamera: object } }) => object) => void };
    }).__OFFICE_STORE__;
    store.setState((s) => ({ worldConstants: { ...s.worldConstants, fixedCamera: { ...s.worldConstants.fixedCamera, pitchDeg: p } } }));
  }, pitchDeg);
}

async function addRoom(page: Page, withRoof: boolean): Promise<void> {
  await page.evaluate(
    ({ half, step, wallLayers, roofLayer, kind, withRoof }) => {
      type Instance = { id: string; sourceCommandId: string; kindId: string; position: [number, number, number] };
      type State = { selfId: string; players: Record<string, { pos: { x: number; z: number } }>; worldObjects: { instances: Instance[] } };
      const store = (window as unknown as {
        __OFFICE_STORE__: { getState: () => State; setState: (u: (s: State) => object) => void };
      }).__OFFICE_STORE__;
      const self = store.getState().players[store.getState().selfId].pos;
      const cx = Math.round(self.x / 0.5);
      const cz = Math.round(self.z / 0.5);
      const added: Instance[] = [];
      for (const y of wallLayers) {
        for (let a = -half; a <= half; a += step) {
          for (const edge of [-half, half]) {
            added.push({ id: `cut/n${y}_${a}_${edge}`, sourceCommandId: 'cut/room', kindId: kind, position: [cx + a, y, cz + edge] });
            if (Math.abs(a) !== half) {
              added.push({ id: `cut/e${y}_${a}_${edge}`, sourceCommandId: 'cut/room', kindId: kind, position: [cx + edge, y, cz + a] });
            }
          }
        }
      }
      if (withRoof) {
        for (let a = -half; a <= half; a += step) {
          for (let b = -half; b <= half; b += step) {
            added.push({ id: `cut/r${a}_${b}`, sourceCommandId: 'cut/room', kindId: kind, position: [cx + a, roofLayer, cz + b] });
          }
        }
      }
      store.setState((s) => ({ worldObjects: { ...s.worldObjects, instances: [...s.worldObjects.instances, ...added] } }));
    },
    { half: HALF, step: STEP, wallLayers: WALL_LAYERS, roofLayer: ROOF_LAYER, kind: BLOCK, withRoof },
  );
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `${SHOT_PREFIX}-${name}.png`), timeout: 90_000 });
}

async function waitForAvatar(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (globalThis as unknown as { __OFFICE_MESH_DEBUG__?: unknown }).__OFFICE_MESH_DEBUG__ !== undefined,
    null,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(2000);
}

async function removeRoom(page: Page): Promise<void> {
  await page.evaluate(() => {
    type State = { worldObjects: { instances: Array<{ sourceCommandId: string }> } };
    const store = (window as unknown as { __OFFICE_STORE__: { setState: (u: (s: State) => object) => void } }).__OFFICE_STORE__;
    store.setState((s) => ({
      worldObjects: { ...s.worldObjects, instances: s.worldObjects.instances.filter((i) => !i.sourceCommandId.startsWith('cut/')) },
    }));
  });
}

async function ringAroundBot(page: Page): Promise<boolean> {
  return page.evaluate(
    ({ kind }) => {
      type Instance = { id: string; sourceCommandId: string; kindId: string; position: [number, number, number] };
      type State = { selfId: string; players: Record<string, { pos: { x: number; z: number } }>; worldObjects: { instances: Instance[] } };
      const store = (window as unknown as {
        __OFFICE_STORE__: { getState: () => State; setState: (u: (s: State) => object) => void };
      }).__OFFICE_STORE__;
      const st = store.getState();
      const bot = Object.entries(st.players).find(([id]) => id !== st.selfId)?.[1].pos;
      if (!bot) return false;
      const cx = Math.round(bot.x / 0.5);
      const cz = Math.round(bot.z / 0.5);
      const added: Instance[] = [];
      for (const y of [4, 8]) {
        for (const a of [-4, 0, 4]) {
          for (const b of [-4, 0, 4]) {
            if (a === 0 && b === 0) continue;
            added.push({ id: `cut/b${y}_${a}_${b}`, sourceCommandId: 'cut/ring', kindId: kind, position: [cx + a, y, cz + b] });
          }
        }
      }
      store.setState((s) => ({ worldObjects: { ...s.worldObjects, instances: [...s.worldObjects.instances, ...added] } }));
      return true;
    },
    { kind: BLOCK },
  );
}

for (const [view, pitch] of [
  ['birds-eye', -89.9],
  ['angled', -55],
] as const) {
  test(`${view}: a roof over the player is cut away and comes back`, async ({ page }) => {
    test.setTimeout(300_000);
    await openDefaultMap(page);
    await waitForAvatar(page);
    await setPitch(page, pitch);
    await page.waitForTimeout(800);
    await shot(page, `${view}-open`);
    await addRoom(page, true);
    if (!SHOT_PREFIX.startsWith('main')) {
      await page.waitForFunction(
        () => ((window as unknown as { __OFFICE_OCCLUSION__?: Marker }).__OFFICE_OCCLUSION__?.cutaway ?? 0) > 0,
        null,
        { timeout: 15_000 },
      );
    }
    await page.waitForTimeout(2500);
    await shot(page, `${view}-roofed`);
    if (SHOT_PREFIX.startsWith('main')) return;
    await removeRoom(page);
    await page.waitForFunction(
      () => ((window as unknown as { __OFFICE_OCCLUSION__?: Marker }).__OFFICE_OCCLUSION__?.cutaway ?? 1) === 0,
      null,
      { timeout: 15_000 },
    );
  });
}

test('angled: a character hidden behind walls shows as a silhouette', async ({ page }) => {
  test.setTimeout(300_000);
  await openDefaultMap(page);
  await waitForAvatar(page);
  await setPitch(page, -35);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Walk to me')?.click();
  });
  await page.waitForTimeout(9000);
  await shot(page, 'silhouette-before');
  expect(await ringAroundBot(page)).toBe(true);
  await page.waitForTimeout(2500);
  await shot(page, 'silhouette-ring');
});
