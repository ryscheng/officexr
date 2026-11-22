/**
 * Not a regression test: writes one screenshot and one box dump per scenario, device and theme into
 * `$HUD_CAPTURE_DIR` (for example `docs/hud-review/before`). Skipped unless that variable is set.
 *   HUD_CAPTURE_DIR=docs/hud-review/before pnpm exec playwright test tests/playwright/hud-capture.spec.ts
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { applySafeArea, collectHudBoxes, findOutside, findOverlaps, HUD_DEVICES, HUD_SCENARIOS, HUD_STATES, openHudPreview, runScenarioSteps, type Theme } from './lib/hudLayout.ts';

const dir = process.env.HUD_CAPTURE_DIR;
test.skip(!dir, 'set HUD_CAPTURE_DIR to capture');
test.describe.configure({ timeout: 180_000, mode: 'parallel' });

const THEMES: Theme[] = ['light', 'dark'];

const only = (name: string) => process.env[name]?.split(',').filter(Boolean);
const deviceFilter = only('HUD_CAPTURE_DEVICES');
const scenarioFilter = only('HUD_CAPTURE_SCENARIOS');

for (const device of HUD_DEVICES.filter((d) => !deviceFilter || deviceFilter.includes(d.id))) {
  const scenarios = [...HUD_SCENARIOS, ...Object.keys(HUD_STATES)].filter((s) => !scenarioFilter || scenarioFilter.includes(s));
  for (const scenario of scenarios) {
    for (const theme of THEMES) {
      test(`${scenario} ${device.id} ${theme}`, async ({ browser }) => {
        const out = path.resolve(dir!);
        mkdirSync(out, { recursive: true });
        const base = `${scenario}__${device.id}__${theme}`;
        test.skip(existsSync(path.join(out, `${base}.json`)) && !process.env.HUD_CAPTURE_FORCE, 'already captured');
        const { page, close } = await openHudPreview(browser, device, scenario, theme);
        try {
          await applySafeArea(page, device.safe);
          await runScenarioSteps(page, scenario);
          if (scenario === 'chat-peek' || scenario.endsWith('-toast')) {
            // The preview lasts 5 s and a software-GL screenshot can take longer, so grab the frame straight from the browser.
            const cdp = await page.context().newCDPSession(page);
            const { data } = await cdp.send('Page.captureScreenshot');
            writeFileSync(path.join(out, `${base}.png`), Buffer.from(data, 'base64'));
          } else {
            await page.screenshot({ path: path.join(out, `${base}.png`), timeout: 60_000 });
          }
          const boxes = await collectHudBoxes(page);
          const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
          const report = {
            viewport,
            overlaps: findOverlaps(boxes).map(([a, b]) => [a.name, b.name]),
            outside: findOutside(boxes, viewport, device.safe).map((b) => b.name),
            smallTargets: device.options?.hasTouch ? boxes.filter((b) => b.interactive && (b.w < 44 || b.h < 44) && !/input/i.test(b.name)).map((b) => `${b.name} ${Math.round(b.w)}x${Math.round(b.h)}`) : [],
            boxes,
          };
          writeFileSync(path.join(out, `${base}.json`), JSON.stringify(report, null, 1));
        } finally {
          await close();
        }
      });
    }
  }
}

