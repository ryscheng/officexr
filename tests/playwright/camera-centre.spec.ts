/** The fixed-angle views (Map, Bird's-eye, Angled) keep the player at the centre of the screen, standing and walking. */
import { mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { HUD_DEVICES, openHudPreview } from './lib/hudLayout.ts';

test.describe.configure({ timeout: 180_000 });

const SHOT_DIR = process.env.CENTRE_SHOTS_DIR;
const SHOT_PREFIX = process.env.CENTRE_SHOT_PREFIX ?? 'run';
const DEVICES = HUD_DEVICES.filter((d) => ['iphone13-portrait', 'iphone13-landscape', 'desktop'].includes(d.id));
const VIEWS = [
  { name: 'map', viewMode: '2d', gameView: 'angled', fixed: true },
  { name: 'birds-eye', viewMode: '3d', gameView: 'birds-eye', fixed: true },
  { name: 'angled', viewMode: '3d', gameView: 'angled', fixed: true },
  { name: 'free-look', viewMode: '3d', gameView: 'free-look', fixed: false },
] as const;

const STANDING_LIMIT = 0.02;
const WALKING_LIMIT = 0.03;

type Hook = { selfPos: () => { x: number; z: number } | null };
const selfPos = (page: Page) => page.evaluate(() => (window as unknown as { __hudPreview: Hook }).__hudPreview.selfPos());

type Probe = { selfNdc: () => { x: number; y: number } | null };
const selfNdc = (page: Page) => page.evaluate(() => (globalThis as unknown as { __OFFICE_CAMERA__?: Probe }).__OFFICE_CAMERA__?.selfNdc() ?? null);

async function sample(page: Page, count: number, gapMs: number) {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const ndc = await selfNdc(page);
    expect(ndc, 'the camera probe is up').not.toBeNull();
    out.push(ndc!);
    await page.waitForTimeout(gapMs);
  }
  return out;
}

const DIRECTIONS = [
  { key: 'KeyW', dx: 0, dy: -45 },
  { key: 'KeyS', dx: 0, dy: 45 },
  { key: 'KeyD', dx: 45, dy: 0 },
  { key: 'KeyA', dx: -45, dy: 0 },
] as const;

/** Holds a walk input in the first direction the player can actually move in, and leaves it held. */
async function walkSomewhere(page: Page, touch: boolean, start: { x: number; z: number }) {
  const { width, height } = page.viewportSize()!;
  const stick = page.locator('[data-hud-item="Joystick"]');
  const fixed = (await stick.count()) > 0 && (await stick.getAttribute('data-joystick-floating')) === null;
  const box = fixed ? await stick.boundingBox() : null;
  const open = await page.evaluate(
    ([w, h]) => {
      for (const fy of [0.78, 0.65, 0.5, 0.35]) {
        for (const fx of [0.25, 0.4, 0.55, 0.7]) {
          const px = Math.round(w! * fx);
          const py = Math.round(h! * fy);
          if (document.elementFromPoint(px, py) instanceof HTMLCanvasElement) {
            return { x: px, y: py };
          }
        }
      }
      return { x: Math.round(w! * 0.25), y: Math.round(h! * 0.78) };
    },
    [width, height] as const,
  );
  const x = box ? Math.round(box.x + box.width / 2) : open.x;
  const y = box ? Math.round(box.y + box.height / 2) : open.y;
  const cdp = touch ? await page.context().newCDPSession(page) : null;
  for (const dir of DIRECTIONS) {
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dir.dx, y: y + dir.dy }] });
    } else {
      await page.keyboard.down(dir.key);
    }
    await page.waitForTimeout(1500);
    const at = (await selfPos(page))!;
    const stop = async () => {
      if (cdp) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.keyboard.up(dir.key);
      }
    };
    if (Math.hypot(at.x - start.x, at.z - start.z) > 1) {
      return { stop };
    }
    await stop();
  }
  throw new Error('the player could not walk in any direction');
}

const worst = (points: { x: number; y: number }[]) => Math.max(...points.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]));

async function shot(page: Page, name: string) {
  if (SHOT_DIR) {
    mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOT_DIR, `${SHOT_PREFIX}-${name}.png`) });
  }
}

for (const device of DEVICES) {
  for (const view of VIEWS) {
    test(`${view.name} on ${device.id}`, async ({ browser }) => {
      const { page, close } = await openHudPreview(browser, device, 'alone', 'light');
      try {
        await page.evaluate(
          ([mode, game]) => {
            localStorage.setItem('officexr:viewMode', mode!);
            localStorage.setItem('officexr:gameView', game!);
          },
          [view.viewMode, view.gameView] as const,
        );
        await page.reload();
        await page.getByRole('button', { name: 'Office menu' }).first().waitFor({ timeout: 60_000 });
        await page.waitForTimeout(2500);

        const standing = await sample(page, 3, 200);
        const start = (await selfPos(page))!;
        await shot(page, `${view.name}-${device.id}-standing`);

        const walk = await walkSomewhere(page, device.options?.hasTouch === true, start);
        const walking = await sample(page, 6, 200);
        await shot(page, `${view.name}-${device.id}-walking`);
        await walk.stop();

        const record = { view: view.name, device: device.id, standing: worst(standing), walking: worst(walking), walkingNdc: walking[walking.length - 1] };
        if (SHOT_DIR) {
          appendFileSync(path.join(SHOT_DIR, `${SHOT_PREFIX}-ndc.jsonl`), `${JSON.stringify(record)}\n`);
        }
        if (view.fixed) {
          expect(record.standing, 'standing offset from the screen centre').toBeLessThan(STANDING_LIMIT);
          expect(record.walking, 'walking offset from the screen centre').toBeLessThan(WALKING_LIMIT);
        }
      } finally {
        await close();
      }
    });
  }
}
