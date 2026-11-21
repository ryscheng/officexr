import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { goToDebugWithMap } from './motion-helpers.ts';
import { MONITOR_DIMENSIONS, monitorGlb } from './lib/monitor-glb.ts';

const SHOT_DIR = process.env.DESK_SHOT_DIR;
const SHOT_CLIP = process.env.DESK_SHOT_CLIP?.split(',').map(Number);
const SHOT_SETTLE_MS = Number(process.env.DESK_SHOT_SETTLE_MS ?? 4000);
const DESK_KIND = 'furniture_table_medium';
const CHAIR_KIND = 'furniture_chair_a';
const MONITOR_KIND = 'test_office_monitor';
const MONITOR_PATH = '/models/test/office_monitor.glb';

interface Marker {
  screens: Array<{ deskAreaId: string; monitorInstanceId: string; on: boolean; glow: number }>;
}

const readScreens = (page: Page) =>
  page.evaluate(() => (window as unknown as { __OFFICE_DESK_SCREENS__?: Marker }).__OFFICE_DESK_SCREENS__?.screens ?? []);

async function serveMonitorKind(page: Page): Promise<void> {
  const glb = Buffer.from(await monitorGlb());
  await page.route(`**${MONITOR_PATH}`, (route) =>
    route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: glb, headers: { 'access-control-allow-origin': '*' } }),
  );
  await page.route('**/api/world-object-kinds', async (route) => {
    const response = await route.fetch();
    const catalog = await response.json();
    const { isDesk: _isDesk, ...template } = catalog.kinds.find((k: { id: string }) => k.id === 'furniture_table_small');
    const { width, height, depth } = MONITOR_DIMENSIONS;
    catalog.kinds.push({
      ...template,
      id: MONITOR_KIND,
      label: 'Office monitor',
      gltfPath: MONITOR_PATH,
      dimensions: MONITOR_DIMENSIONS,
      localAABB: { min: { x: -width / 2, y: 0, z: -depth / 2 }, max: { x: width / 2, y: height, z: depth / 2 } },
    });
    await route.fulfill({ response, json: catalog });
  });
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOT_DIR) return;
  await page.waitForTimeout(SHOT_SETTLE_MS);
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  mkdirSync(SHOT_DIR, { recursive: true });
  const vp = page.viewportSize();
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}-${vp?.width}x${vp?.height}.png`) });
  if (SHOT_CLIP?.length === 4) {
    const [x, y, width, height] = SHOT_CLIP;
    await page.screenshot({ path: path.join(SHOT_DIR, `${name}-zoom.png`), clip: { x, y, width, height } });
  }
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
  await page.waitForTimeout(2500);
}

async function placeDesk(page: Page, withMonitor: boolean): Promise<void> {
  await page.evaluate(
    ({ desk, chair, monitor, withMonitor }) => {
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
      if (withMonitor) {
        instances.push({ id: 'desk-test/monitor', sourceCommandId: 'desk-test', kindId: monitor, position: [cx + 2, cy + 2, cz - 10] });
      }
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
    { desk: DESK_KIND, chair: CHAIR_KIND, monitor: MONITOR_KIND, withMonitor },
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

const renderedKinds = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __OFFICE_OBJECT_INSTANCES__?: { perKind: Array<{ kindId: string; count: number }> } })
        .__OFFICE_OBJECT_INSTANCES__?.perKind.map((k) => k.kindId) ?? [],
  );

test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: Number(process.env.DESK_SHOT_SCALE ?? 1) });

test('the monitor already on the desk lights while its chair is occupied', async ({ page }) => {
  test.setTimeout(240_000);
  await serveMonitorKind(page);
  await openDefaultMap(page);
  await placeDesk(page, true);
  await expect.poll(async () => (await readScreens(page)).length, { timeout: 30_000 }).toBe(1);
  expect((await readScreens(page))[0]).toMatchObject({ monitorInstanceId: 'desk-test/monitor', on: false, glow: 0 });
  await page.waitForTimeout(3000);
  await shot(page, 'before-sit');

  await setSeat(page, 'desk-test/chair');
  await expect.poll(async () => (await readScreens(page))[0]?.on).toBe(true);
  await expect.poll(async () => (await readScreens(page))[0]?.glow).toBe(1);
  await page.waitForTimeout(2000);
  await shot(page, 'seated');

  await setSeat(page, null);
  await expect.poll(async () => (await readScreens(page))[0]?.on, { timeout: 5_000 }).toBe(false);
  expect((await readScreens(page))[0].glow).toBe(0);
  await page.waitForTimeout(2000);
  await shot(page, 'stood');
});

test('a desk without a monitor gets none and nothing changes when someone sits', async ({ page }) => {
  test.setTimeout(240_000);
  await serveMonitorKind(page);
  await openDefaultMap(page);
  await placeDesk(page, false);
  await expect.poll(async () => (await renderedKinds(page)).includes(CHAIR_KIND), { timeout: 30_000 }).toBe(true);
  await setSeat(page, 'desk-test/chair');
  await page.waitForTimeout(1500);
  expect(await readScreens(page)).toEqual([]);
  expect(await renderedKinds(page)).not.toContain(MONITOR_KIND);
});
