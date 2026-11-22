import { devices, type Browser, type Page } from '@playwright/test';

export const HUD_BASE_URL = process.env.HUD_BASE_URL ?? 'http://localhost:5176';

export const HUD_SCENARIOS = ['crowd', 'alone', 'wand', 'build', 'focus', 'full', 'missions', 'new-mission', 'chat'] as const;

const HINT_NAMES = ['move', 'people', 'alone', 'build'];

export const HUD_STATES: Record<string, { scenario: string; steps: (string | RegExp)[]; stallMs?: number; hint?: string; only?: string[] }> = {
  rest: { scenario: 'crowd', steps: [] },
  moving: { scenario: 'crowd', steps: ['move'] },
  'missions-sheet': { scenario: 'missions', steps: [/^Expand missions$/] },
  'chat-rest': { scenario: 'chat', steps: [] },
  'chat-peek': { scenario: 'chat', steps: ['say:bao@example.test:Lunch at 12? I booked the big room by the window.'] },
  'chat-sheet': { scenario: 'chat', steps: [/^Chat/] },
  'menu-open': { scenario: 'crowd', steps: ['Office menu'] },
  'settings-open': { scenario: 'crowd', steps: ['Office menu', /^Office\s*Name, map/] },
  'settings-controls': { scenario: 'crowd', steps: ['Office menu', /^Controls\s*View/] },
  'invite-open': { scenario: 'crowd', steps: ['Office menu', 'Invite people'] },
  'people-open': { scenario: 'crowd', steps: [/^People here, \d+$/] },
  'person-card': { scenario: 'crowd', steps: [/^People here, \d+$/, /Show options$/] },
  'mission-form': { scenario: 'missions', steps: [/^Expand missions$/, 'Add mission'] },
  'mission-form-more': { scenario: 'missions', steps: [/^Expand missions$/, 'Add mission', /^More: place/] },
  'mission-done': { scenario: 'missions', steps: [/^Expand missions$/, 'check:Fix the login redirect'] },
  'mission-keyboard': { scenario: 'missions', steps: [/^Expand missions$/, 'Add mission', 'keyboard'] },
  'chat-keyboard': { scenario: 'chat', steps: [/^Chat/, 'keyboard'] },
  'conn-reconnecting': { scenario: 'crowd', steps: ['net:reconnecting'] },
  'conn-cannot': { scenario: 'crowd', steps: ['net:cannot'], stallMs: 400 },
  'conn-offline': { scenario: 'crowd', steps: ['net:offline'] },
  'conn-recovered': { scenario: 'crowd', steps: ['net:reconnecting', 'net:live'] },
  'near-person': { scenario: 'near', steps: [] },
  'ping-toast': { scenario: 'ping', steps: [] },
  'invite-toast': { scenario: 'invite', steps: [] },
  'wave-toast': { scenario: 'wave', steps: [] },
  'text-only': { scenario: 'text-only', steps: [] },
  'hint-move': { scenario: 'alone', steps: [], hint: 'move' },
  'hint-people': { scenario: 'spread', steps: [], hint: 'people' },
  'hint-alone': { scenario: 'alone', steps: [], hint: 'alone', only: ['desktop', 'iphone13-portrait', 'iphone13-landscape'] },
  'hint-build': { scenario: 'chat', steps: ['Office menu'], hint: 'build', only: ['desktop'] },
  'interact-seat': { scenario: 'interact-seat', steps: ['place:14:12'] },
  'interact-rack': { scenario: 'interact-rack', steps: ['place:14:12'] },
  'build-palette': { scenario: 'build', steps: ['Office menu', 'Build'] },
  'build-placed': { scenario: 'build', steps: ['Office menu', 'Build', 'Place'] },
};
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
  const seen = HINT_NAMES.filter((name) => name !== HUD_STATES[scenario]?.hint);
  await context.addInitScript(
    ([t, names]) => {
      try {
        localStorage.setItem('officexr:appearance', t!);
        for (const name of names!.split(',')) {
          localStorage.setItem(`officexr:hint:${name}`, 'done');
        }
      } catch {
        // storage can be blocked
      }
    },
    [theme, seen.join(',')] as const,
  );
  const viewport = device.options?.viewport;
  if (viewport && viewport.width > viewport.height) {
    await context.addInitScript(() => {
      const sideways = Object.assign(new EventTarget(), { type: 'landscape-primary' });
      Object.defineProperty(window.screen, 'orientation', { value: sideways, configurable: true });
    });
  }
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  const stallMs = HUD_STATES[scenario]?.stallMs;
  await page.goto(`/hud-preview?scenario=${HUD_STATES[scenario]?.scenario ?? scenario}${stallMs ? `&stallMs=${stallMs}` : ''}`);
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
  /** Scrolled or clipped by an ancestor, so the size is the visible part and not the control's own. */
  clipped: boolean;
  /** The sheet itself, which is anchored to the bottom edge by design; its controls are separate boxes. */
  sheet: boolean;
}

/** Every visible control or panel of the HUD: buttons, inputs and status regions that have a size on screen. */
export async function collectHudBoxes(page: Page): Promise<HudBox[]> {
  return page.evaluate(() => {
    const seen: { el: Element; name: string; interactive: boolean; x: number; y: number; w: number; h: number; clipped: boolean; sheet: boolean }[] = [];
    const selector = 'button, input, textarea, [role="status"], [role="dialog"], [data-hud-item]';
    const modal = document.querySelector('[data-hud-modal]');
    for (const el of document.querySelectorAll(selector)) {
      if (el.closest('[data-hud-ignore]')) continue;
      if (modal && !modal.contains(el)) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
      if (el.closest('[inert],[aria-hidden="true"]')) continue;
      const own = el.getBoundingClientRect();
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
      seen.push({ el, name, interactive: el.matches('button, input, textarea, a[href]'), x: r.x, y: r.y, w: r.width, h: r.height, clipped: r.width < own.width - 1 || r.height < own.height - 1, sheet: el.matches('[data-hud-modal]') });
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
    (b) => !b.sheet && (b.x < safe.left - 0.5 || b.y < safe.top - 0.5 || b.x + b.w > viewport.width - safe.right + 0.5 || b.y + b.h > viewport.height - safe.bottom + 0.5),
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
  ...Object.fromEntries(Object.entries(HUD_STATES).map(([id, state]) => [id, state.steps])),
  build: ['key:b'],
  'new-mission': [/^Expand missions$/, 'Add mission'],
  focus: [/^People here, \d+$/],
  full: [/^People here, \d+$/],
};

/** Opens the panel a scenario is about, by clicking the named buttons in order (`key:x` presses a key); a button this layout lacks is skipped. */
export async function runScenarioSteps(page: Page, scenario: string): Promise<void> {
  for (const name of SCENARIO_STEPS[scenario] ?? []) {
    if (name === 'move') {
      await dragStick(page);
      continue;
    }
    if (name === 'keyboard') {
      const { width, height } = page.viewportSize()!;
      await page.evaluate(() => {
        const upright = Object.assign(new EventTarget(), { type: 'portrait-primary' });
        Object.defineProperty(window.screen, 'orientation', { value: upright, configurable: true });
        upright.dispatchEvent(new Event('change'));
      });
      await page.setViewportSize({ width, height: height - Math.round(height * 0.42) });
      await page.waitForTimeout(800);
      continue;
    }
    if (typeof name === 'string' && name.startsWith('net:')) {
      const net = name.slice(4);
      if (net === 'offline') {
        await page.context().setOffline(true);
      } else {
        const status = net === 'cannot' ? 'reconnecting' : net;
        await page.evaluate((st) => (window as unknown as { __hudPreview: { setStatus: (s: string) => void } }).__hudPreview.setStatus(st), status);
      }
      if (net === 'cannot') {
        await page.getByRole('alert').waitFor();
      }
      await page.waitForTimeout(600);
      continue;
    }
    if (typeof name === 'string' && name.startsWith('check:')) {
      await page.getByRole('checkbox', { name: `${name.slice(6)}, done` }).dispatchEvent('click');
      await page.waitForTimeout(600);
      continue;
    }
    if (typeof name === 'string' && name.startsWith('say:')) {
      const [, from, ...text] = name.split(':');
      await page.evaluate(([f, t]) => (window as unknown as { __hudPreview: { say: (a: string, b: string) => void } }).__hudPreview.say(f!, t!), [from, text.join(':')]);
      await page.waitForTimeout(700);
      continue;
    }
    if (typeof name === 'string' && name.startsWith('place:')) {
      const [, x, z] = name.split(':');
      await page.evaluate(([px, pz]) => (window as unknown as { __hudPreview: { placeSelf: (a: number, b: number) => void } }).__hudPreview.placeSelf(Number(px), Number(pz)), [x, z]);
      await page.waitForTimeout(2500);
      continue;
    }
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

export interface HintBox {
  x: number;
  y: number;
  width: number;
  height: number;
  count: number;
}

/** Waits for the named hint to show and stay a moment, then reads its box and the number of hints in the same step. A toast can cut a hint short; it comes back. */
export async function awaitHint(page: Page, hint: string): Promise<HintBox> {
  const plate = page.locator(`[data-hint="${hint}"]`);
  const deadline = Date.now() + 100_000;
  while (Date.now() < deadline) {
    await plate.waitFor({ state: 'visible', timeout: Math.max(1_000, deadline - Date.now()) });
    await page.waitForTimeout(1_500);
    const seen = await page.evaluate((name) => {
      const r = document.querySelector(`[data-hint="${name}"]`)?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height, count: document.querySelectorAll('[data-hint]').length } : null;
    }, hint);
    if (seen) {
      return seen;
    }
  }
  throw new Error(`the ${hint} hint did not stay on screen`);
}

export async function dragStick(page: Page, holdMs = 2300): Promise<() => Promise<void>> {
  const { width, height } = page.viewportSize()!;
  const stick = page.locator('[data-hud-item="Joystick"]');
  const fixed = (await stick.count()) > 0 && (await stick.getAttribute('data-joystick-floating')) === null;
  const box = fixed ? await stick.boundingBox() : null;
  const cdp = await page.context().newCDPSession(page);
  const y = box ? Math.round(box.y + box.height / 2) : Math.round(height * 0.78);
  const x = box ? Math.round(box.x + box.width / 2) : Math.round(width * 0.25);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 45, y }] });
  await page.waitForTimeout(holdMs);
  return async () => void (await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }));
}

export function findTightGaps(boxes: HudBox[], minGapPx = 8, tolerancePx = 0.5): [HudBox, HudBox][] {
  const targets = boxes.filter((b) => b.interactive && !b.clipped);
  const out: [HudBox, HudBox][] = [];
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i]!;
      const b = targets[j]!;
      if (contains(a, b) || contains(b, a)) continue;
      const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0);
      const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0);
      if (Math.hypot(dx, dy) < minGapPx - tolerancePx) out.push([a, b]);
    }
  }
  return out;
}

export function findInGestureStrip(boxes: HudBox[], viewport: { height: number }, stripPx = 16): HudBox[] {
  return boxes.filter((b) => b.interactive && b.y + b.h > viewport.height - stripPx + 0.5);
}

export function hudCoverage(boxes: HudBox[], viewport: { width: number; height: number }): number {
  const cells = new Uint8Array(viewport.width * viewport.height);
  for (const b of boxes) {
    const x0 = Math.max(0, Math.floor(b.x));
    const x1 = Math.min(viewport.width, Math.ceil(b.x + b.w));
    const y0 = Math.max(0, Math.floor(b.y));
    const y1 = Math.min(viewport.height, Math.ceil(b.y + b.h));
    for (let y = y0; y < y1; y++) cells.fill(1, y * viewport.width + x0, y * viewport.width + x1);
  }
  let covered = 0;
  for (const c of cells) covered += c;
  return covered / cells.length;
}

export function findInMiddleThird(boxes: HudBox[], viewport: { height: number }): HudBox[] {
  const top = viewport.height / 3;
  const bottom = (viewport.height * 2) / 3;
  return boxes.filter((b) => b.y < bottom - 0.5 && b.y + b.h > top + 0.5);
}
