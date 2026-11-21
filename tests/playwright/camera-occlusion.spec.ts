import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { goToDebugWithMap } from './motion-helpers.ts';

const SHOT_DIR = process.env.OCCLUSION_SHOT_DIR;
const SHOT_PREFIX = process.env.OCCLUSION_SHOT_PREFIX ?? 'branch';

const WALL_KIND = 'colored_block_blue';
const RING_OFFSETS = [-8, -4, 0, 4, 8];
const WALL_LAYERS = [4, 8, 12, 16];

interface Marker {
  fading: number;
}

const readMarker = (page: Page): Promise<Marker | undefined> =>
  page.evaluate(() => (window as unknown as { __OFFICE_OCCLUSION__?: Marker }).__OFFICE_OCCLUSION__);

async function removeWallRing(page: Page): Promise<void> {
  await page.evaluate(() => {
    type State = { worldObjects: { instances: Array<{ sourceCommandId: string }> } };
    const store = (window as unknown as {
      __OFFICE_STORE__: { setState: (u: (s: State) => object) => void };
    }).__OFFICE_STORE__;
    store.setState((s) => ({
      worldObjects: { ...s.worldObjects, instances: s.worldObjects.instances.filter((i) => i.sourceCommandId !== 'occl/ring') },
    }));
  });
}

async function openDefaultMap(page: Page): Promise<void> {
  await goToDebugWithMap(page, 'default');
  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __OFFICE_STORE__?: { getState: () => { worldObjects?: { instances: unknown[] } } };
      };
      return (w.__OFFICE_STORE__?.getState().worldObjects?.instances.length ?? 0) > 0;
    },
    null,
    { timeout: 40_000 },
  );
  const narrow = (page.viewportSize()?.width ?? 1280) < 600;
  if (narrow) await page.addStyleTag({ content: 'aside { display: none !important; }' });
  await page.waitForTimeout(2500);
}

async function buildWallRing(page: Page): Promise<void> {
  await page.evaluate(
    ({ offsets, layers, kind }) => {
      type Instance = { id: string; sourceCommandId: string; kindId: string; position: [number, number, number] };
      type State = { selfId: string; players: Record<string, { pos: { x: number; z: number } }>; worldObjects: { instances: Instance[] } };
      const store = (window as unknown as {
        __OFFICE_STORE__: { getState: () => State; setState: (u: (s: State) => object) => void };
      }).__OFFICE_STORE__;
      const self = store.getState().players[store.getState().selfId].pos;
      const cx = Math.round(self.x / 0.5);
      const cz = Math.round(self.z / 0.5);
      const added: Instance[] = [];
      for (const y of layers) {
        for (const a of offsets) {
          for (const edge of [-8, 8]) {
            added.push({ id: `occl/n${y}_${a}_${edge}`, sourceCommandId: 'occl/ring', kindId: kind, position: [cx + a, y, cz + edge] });
            if (Math.abs(a) !== 8) {
              added.push({ id: `occl/e${y}_${a}_${edge}`, sourceCommandId: 'occl/ring', kindId: kind, position: [cx + edge, y, cz + a] });
            }
          }
        }
      }
      store.setState((s) => ({ worldObjects: { ...s.worldObjects, instances: [...s.worldObjects.instances, ...added] } }));
    },
    { offsets: RING_OFFSETS, layers: WALL_LAYERS, kind: WALL_KIND },
  );
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  const vp = page.viewportSize();
  await page.screenshot({ path: path.join(SHOT_DIR, `${SHOT_PREFIX}-${name}-${vp?.width}x${vp?.height}.png`) });
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('Angled: walls between the camera and the player fade, then come back', async ({ page }) => {
      test.setTimeout(90_000);
      await openDefaultMap(page);
      await shot(page, 'angled-open');
      expect((await readMarker(page))?.fading ?? 0).toBe(0);
      await buildWallRing(page);
      await page.waitForFunction(
        () => ((window as unknown as { __OFFICE_OCCLUSION__?: Marker }).__OFFICE_OCCLUSION__?.fading ?? 0) > 0,
        null,
        { timeout: 15_000 },
      );
      await page.waitForTimeout(1500);
      await shot(page, 'angled-wall-faded');
      const faded = (await readMarker(page))?.fading ?? 0;
      expect(faded).toBeGreaterThan(0);
      expect(faded).toBeLessThan(64);
      await removeWallRing(page);
      await page.waitForFunction(
        () => ((window as unknown as { __OFFICE_OCCLUSION__?: Marker }).__OFFICE_OCCLUSION__?.fading ?? 1) === 0,
        null,
        { timeout: 15_000 },
      );
    });

    test('Free look: a wall behind the player fades', async ({ page }) => {
      test.setTimeout(90_000);
      await openDefaultMap(page);
      await page.keyboard.press('Alt+KeyP');
      await page.keyboard.press('Alt+KeyP');
      await page.waitForFunction(
        () => (window as unknown as { __OFFICE_OCCLUSION__?: Marker }).__OFFICE_OCCLUSION__ !== undefined,
        null,
        { timeout: 15_000 },
      );
      await page.waitForTimeout(800);
      await shot(page, 'freelook-open');
      expect((await readMarker(page))?.fading ?? 0).toBe(0);
      await buildWallRing(page);
      await page.waitForFunction(
        () => ((window as unknown as { __OFFICE_OCCLUSION__?: Marker }).__OFFICE_OCCLUSION__?.fading ?? 0) > 0,
        null,
        { timeout: 15_000 },
      );
      await page.waitForTimeout(1500);
      await shot(page, 'freelook-wall-faded');
      expect((await readMarker(page))?.fading ?? 0).toBeGreaterThan(0);
      await removeWallRing(page);
      await page.waitForFunction(
        () => ((window as unknown as { __OFFICE_OCCLUSION__?: Marker }).__OFFICE_OCCLUSION__?.fading ?? 1) === 0,
        null,
        { timeout: 15_000 },
      );
    });
  });
}
