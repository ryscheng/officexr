import { devices, type Browser, type Page } from '@playwright/test';

export const HUD_BASE_URL = process.env.HUD_BASE_URL ?? 'http://localhost:5176';

export const HUD_SCENARIOS = ['crowd', 'alone', 'wand', 'build', 'focus', 'full', 'missions', 'new-mission'] as const;
export type HudScenario = (typeof HUD_SCENARIOS)[number];

export interface HudDevice {
  id: string;
  /** Playwright context options. */
  options: Parameters<Browser['newContext']>[0];
  /** Safe-area insets of the real device, which Chromium emulation reports as zero. */
  safe: { top: number; right: number; bottom: number; left: number };
}

/** Device options for Chromium, at 1x so software WebGL stays fast; layout depends on CSS pixels only. */
const without = ({ defaultBrowserType: _ignored, ...rest }: (typeof devices)[string]) => ({ ...rest, deviceScaleFactor: 1 });

export const HUD_DEVICES: HudDevice[] = [
  { id: 'iphone13-portrait', options: without(devices['iPhone 13']), safe: { top: 47, right: 0, bottom: 34, left: 0 } },
  { id: 'iphone13-landscape', options: without(devices['iPhone 13 landscape']), safe: { top: 0, right: 47, bottom: 21, left: 47 } },
  { id: 'iphone-se-portrait', options: without(devices['iPhone SE']), safe: { top: 20, right: 0, bottom: 0, left: 0 } },
  { id: 'pixel5-portrait', options: without(devices['Pixel 5']), safe: { top: 24, right: 0, bottom: 0, left: 0 } },
  { id: 'pixel5-landscape', options: without(devices['Pixel 5 landscape']), safe: { top: 0, right: 0, bottom: 0, left: 0 } },
  { id: 'ipad-landscape', options: without(devices['iPad Pro 11 landscape']), safe: { top: 24, right: 0, bottom: 20, left: 0 } },
  { id: 'desktop', options: { viewport: { width: 1440, height: 900 } }, safe: { top: 0, right: 0, bottom: 0, left: 0 } },
];

export type Theme = 'light' | 'dark';

/** Opens `/hud-preview?scenario=` in a fresh context and waits until the HUD is up. */
export async function openHudPreview(browser: Browser, device: HudDevice, scenario: string, theme: Theme): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ ...device.options, baseURL: HUD_BASE_URL });
  await context.addInitScript((t) => {
    try {
      localStorage.setItem('officexr:appearance', t);
    } catch {
      // storage can be blocked
    }
  }, theme);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  await page.goto(`/hud-preview?scenario=${scenario}`);
  await page.getByRole('button', { name: 'Office menu' }).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  return { page, close: () => context.close() };
}

export interface HudBox {
  name: string;
  /** A button, link or field a finger has to hit, as opposed to a panel or status region. */
  interactive: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Every visible control or panel of the HUD: buttons, inputs and status regions that have a size on screen. */
export async function collectHudBoxes(page: Page): Promise<HudBox[]> {
  return page.evaluate(() => {
    const seen: { el: Element; name: string; interactive: boolean; x: number; y: number; w: number; h: number }[] = [];
    const selector = 'button, input, textarea, [role="status"], [role="dialog"], [data-hud-item]';
    const modal = document.querySelector('[data-hud-modal]');
    for (const el of document.querySelectorAll(selector)) {
      if (el.closest('[data-hud-ignore]')) continue;
      if (modal && !modal.contains(el)) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
      if (el.closest('[inert],[aria-hidden="true"]')) continue;
      let left = el.getBoundingClientRect().left;
      let top = el.getBoundingClientRect().top;
      let right = el.getBoundingClientRect().right;
      let bottom = el.getBoundingClientRect().bottom;
      for (let a = el.parentElement; a; a = a.parentElement) {
        const overflow = getComputedStyle(a);
        if (/auto|scroll|hidden/.test(`${overflow.overflowX} ${overflow.overflowY}`)) {
          const c = a.getBoundingClientRect();
          left = Math.max(left, c.left);
          top = Math.max(top, c.top);
          right = Math.min(right, c.right);
          bottom = Math.min(bottom, c.bottom);
        }
      }
      const r = { x: left, y: top, width: right - left, height: bottom - top };
      if (r.width < 2 || r.height < 2) continue;
      const name = el.getAttribute('aria-label') || el.getAttribute('data-hud-item') || (el.textContent ?? '').trim().slice(0, 30) || el.tagName.toLowerCase();
      seen.push({ el, name, interactive: el.matches('button, input, textarea, a[href]'), x: r.x, y: r.y, w: r.width, h: r.height });
    }
    return seen.map(({ el: _el, ...box }) => box);
  });
}

const area = (a: HudBox, b: HudBox) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

const contains = (outer: HudBox, inner: HudBox) =>
  inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.w <= outer.x + outer.w + 0.5 && inner.y + inner.h <= outer.y + outer.h + 0.5;

/** Pairs of boxes that overlap and where neither holds the other (a button inside its own panel is fine). */
export function findOverlaps(boxes: HudBox[], tolerancePx = 2): [HudBox, HudBox][] {
  const out: [HudBox, HudBox][] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (contains(a, b) || contains(b, a)) continue;
      if (area(a, b) > tolerancePx * tolerancePx) out.push([a, b]);
    }
  }
  return out;
}

/** Boxes that leave the viewport shrunk by the device's safe area. */
export function findOutside(boxes: HudBox[], viewport: { width: number; height: number }, safe: HudDevice['safe']): HudBox[] {
  return boxes.filter(
    (b) => b.x < safe.left - 0.5 || b.y < safe.top - 0.5 || b.x + b.w > viewport.width - safe.right + 0.5 || b.y + b.h > viewport.height - safe.bottom + 0.5,
  );
}

/** Applies the device's safe-area insets through the `--hud-safe-*` tokens, since emulation reports zero for `env()`. */
export async function applySafeArea(page: Page, safe: HudDevice['safe']): Promise<void> {
  await page.addStyleTag({
    content: `:root{--hud-safe-top:${safe.top}px;--hud-safe-right:${safe.right}px;--hud-safe-bottom:${safe.bottom}px;--hud-safe-left:${safe.left}px}`,
  });
  await page.waitForTimeout(200);
}

const SCENARIO_STEPS: Record<string, (string | RegExp)[]> = {
  build: ['key:b'],
  'new-mission': [/^Expand missions$/, 'New mission'],
  focus: ['Office menu', 'People here'],
  full: ['Office menu', 'People here'],
};

/** Opens the panel a scenario is about, by clicking the named buttons in order (`key:x` presses a key); a button this layout lacks is skipped. */
export async function runScenarioSteps(page: Page, scenario: string): Promise<void> {
  for (const name of SCENARIO_STEPS[scenario] ?? []) {
    if (typeof name === 'string' && name.startsWith('key:')) {
      await page.keyboard.press(name.slice(4));
      await page.waitForTimeout(600);
      continue;
    }
    const button = page.getByRole('button', { name }).or(page.getByRole('menuitem', { name })).first();
    if ((await button.count()) > 0) {
      await button.click();
      await page.waitForTimeout(600);
    }
  }
}
