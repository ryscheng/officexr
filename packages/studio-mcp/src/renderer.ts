export type RenderCamera = 'top' | 'iso' | { position: [number, number, number]; lookAt: [number, number, number] };

export interface RenderRequest {
  target: { type: 'map' | 'room' | 'layout'; name: string };
  camera: RenderCamera;
  width: number;
  height: number;
}

export interface RenderResult {
  png: Uint8Array;
  /** The scene's world-space AABB in metres, as reported by the render page. */
  bounds: { min: number[]; max: number[] };
  /** Only for the top camera. */
  metresPerPixel?: number;
}

/** Draws a stored document and returns a PNG; rejects with a readable message on any failure. */
export interface ViewRenderer {
  /** `origin` is the studio's own loopback origin, which serves the `?op=render` page. */
  render(origin: string, request: RenderRequest): Promise<RenderResult>;
}

const TOTAL_TIMEOUT_MS = 45_000;

type RenderReady = Omit<RenderResult, 'png'>;

interface RenderSentinels {
  __officexrRenderReady?: RenderReady;
  __officexrRenderError?: string;
}

function renderUrl(origin: string, { target, camera, width, height }: RenderRequest): string {
  const url = new URL('/', origin);
  url.searchParams.set('op', 'render');
  url.searchParams.set('target', target.type);
  url.searchParams.set('name', target.name);
  url.searchParams.set('w', String(width));
  url.searchParams.set('h', String(height));
  if (typeof camera === 'string') {
    url.searchParams.set('camera', camera);
  } else {
    url.searchParams.set('camera', 'custom');
    camera.position.forEach((v, i) => url.searchParams.set(`p${'xyz'[i]}`, String(v)));
    camera.lookAt.forEach((v, i) => url.searchParams.set(`t${'xyz'[i]}`, String(v)));
  }
  return url.toString();
}

/** Headless Chromium via `playwright-core`, loaded on first use so importing this module costs nothing. */
export const chromiumRenderer: ViewRenderer = {
  async render(origin, request) {
    const deadline = Date.now() + TOTAL_TIMEOUT_MS;
    // Every step gets what is left of the one budget; Playwright treats 0 as "no timeout".
    const remaining = () => Math.max(1, deadline - Date.now());

    const { chromium } = await import('playwright-core');
    const browser = await chromium
      .launch({
        executablePath: process.env.OFFICEXR_RENDER_CHROMIUM_PATH || undefined,
        args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        timeout: remaining(),
      })
      .catch((err) => {
        throw new Error(`could not start Chromium (set OFFICEXR_RENDER_CHROMIUM_PATH): ${err.message}`);
      });
    try {
      const page = await browser.newPage({
        viewport: { width: request.width, height: request.height },
        deviceScaleFactor: 1,
      });
      await page.goto(renderUrl(origin, request), { waitUntil: 'domcontentloaded', timeout: remaining() });
      const settled = await page.waitForFunction(
        () => {
          const { __officexrRenderReady: ready, __officexrRenderError: error } = globalThis as unknown as RenderSentinels;
          return ready || error !== undefined ? { ready, error } : null;
        },
        undefined,
        { timeout: remaining(), polling: 100 },
      );
      const { ready, error } = (await settled.jsonValue()) as { ready?: RenderReady; error?: string };
      if (!ready) {
        throw new Error(`render failed: ${error}`);
      }
      const png = await page.locator('canvas').first().screenshot({ type: 'png', timeout: remaining() });
      return { png, ...ready };
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new Error(`render timed out after ${TOTAL_TIMEOUT_MS / 1000} s: ${err.message.split('\n')[0]}`);
      }
      throw err;
    } finally {
      await browser.close();
    }
  },
};
