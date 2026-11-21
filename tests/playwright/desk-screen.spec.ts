import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { goToDebugWithMap } from './motion-helpers.ts';

const SHOT_DIR = process.env.DESK_SHOT_DIR;
const DESK_KIND = 'furniture_table_medium';
const CHAIR_KIND = 'furniture_chair_a';

interface Marker {
  screens: Array<{ deskAreaId: string; seatInstanceId: string; on: boolean }>;
}

const readScreens = (page: Page) =>
  page.evaluate(() => (window as unknown as { __OFFICE_DESK_SCREENS__?: Marker }).__OFFICE_DESK_SCREENS__?.screens ?? []);

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOT_DIR) return;
  await page.waitForTimeout(4000);
  mkdirSync(SHOT_DIR, { recursive: true });
  const vp = page.viewportSize();
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}-${vp?.width}x${vp?.height}.png`) });
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
  if ((page.viewportSize()?.width ?? 1280) < 600) {
    await page.addStyleTag({ content: 'aside { display: none !important; }' });
  }
  await page.waitForTimeout(2500);
}

async function placeDesk(page: Page): Promise<void> {
  await page.evaluate(
    ({ desk, chair }) => {
      type Instance = { id: string; sourceCommandId: string; kindId: string; position: [number, number, number]; yawDeg?: number };
      type State = {
        selfId: string;
        players: Record<string, { pos: { x: number; y: number; z: number } }>;
        worldObjects: { instances: Instance[] };
      };
      const store = (window as unknown as {
        __OFFICE_STORE__: { getState: () => State; setState: (u: (s: State) => object) => void };
      }).__OFFICE_STORE__;
      const self = store.getState().players[store.getState().selfId].pos;
      const cx = Math.round(self.x / 0.5);
      const cz = Math.round(self.z / 0.5);
      const cy = Math.round(self.y / 0.5);
      const instances: Instance[] = [
        { id: 'desk-test/desk', sourceCommandId: 'desk-test', kindId: desk, position: [cx + 2, cy, cz - 10] },
        { id: 'desk-test/chair', sourceCommandId: 'desk-test', kindId: chair, position: [cx + 3, cy, cz - 5], yawDeg: 180 },
      ];
      store.setState((s) => ({
        worldObjects: { ...s.worldObjects, instances: [...s.worldObjects.instances, ...instances] },
        deskAreas: [
          {
            id: 'desk-test-area',
            label: 'Desk',
            min: { x: self.x, z: self.z - 8 },
            max: { x: self.x + 6, z: self.z - 1 },
            seatInstanceId: 'desk-test/chair',
          },
        ],
      }));
    },
    { desk: DESK_KIND, chair: CHAIR_KIND },
  );
}

async function setSeat(page: Page, seat: string | null): Promise<void> {
  await page.evaluate((id) => {
    type State = { selfId: string; players: Record<string, object> };
    const store = (window as unknown as {
      __OFFICE_STORE__: { getState: () => State; setState: (u: (s: State) => object) => void };
    }).__OFFICE_STORE__;
    store.setState((s) => ({ players: { ...s.players, [s.selfId]: { ...s.players[s.selfId], seat: id } } }));
  }, seat);
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    for (const look of ['Angled', 'Free look']) {
      test(`${look}: the desk monitor lights while its chair is occupied`, async ({ page }) => {
        test.setTimeout(90_000);
        await openDefaultMap(page);
        if (look === 'Free look') {
          await page.keyboard.press('Alt+KeyP');
          await page.keyboard.press('Alt+KeyP');
          await page.waitForTimeout(800);
        }
        await placeDesk(page);
        await expect.poll(async () => (await readScreens(page)).length).toBe(1);
        expect((await readScreens(page))[0]).toMatchObject({ seatInstanceId: 'desk-test/chair', on: false });
        await page.waitForTimeout(3000);
        const tag = look === 'Angled' ? 'angled' : 'freelook';
        await shot(page, `${tag}-before-sit`);

        await setSeat(page, 'desk-test/chair');
        await expect.poll(async () => (await readScreens(page))[0]?.on).toBe(true);
        await page.waitForTimeout(2000);
        await shot(page, `${tag}-seated`);

        await setSeat(page, null);
        await expect.poll(async () => (await readScreens(page))[0]?.on, { timeout: 5_000 }).toBe(false);
        await page.waitForTimeout(2000);
        await shot(page, `${tag}-stood`);
      });
    }
  });
}
