import type { Browser, LaunchOptions } from 'playwright-core';

export const RENDER_TARGET_TYPES = ['map', 'room', 'layout'] as const;

type Vec3 = [number, number, number];

export type RenderCamera = { type: 'top' } | { type: 'iso' } | { type: 'custom'; position: Vec3; lookAt: Vec3 };

export interface RenderRequest {
  target: { type: (typeof RENDER_TARGET_TYPES)[number]; name: string };
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

/** A running Chromium: `close` asks it to exit, `kill` forces it. */
export interface ChromiumProcess {
  browser: Pick<Browser, 'newContext'>;
  close(): Promise<void>;
  kill(): Promise<void>;
}

export interface ChromiumRendererOptions {
  /** Chromium binary; Playwright's own download when unset. */
  executablePath?: string;
  /** Budget for one render, from launch until the browser is gone. */
  timeoutMs?: number;
  /** Part of the budget a graceful close may take before the process is killed; the kill gets the same again. */
  closeGraceMs?: number;
  launch?: (options: LaunchOptions & { timeout: number }) => Promise<ChromiumProcess>;
}

type RenderReady = Omit<RenderResult, 'png'>;

interface RenderSentinels {
  __officexrRenderReady?: RenderReady;
  __officexrRenderError?: string;
}

const firstLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).split('\n')[0];

/** Settles like `work`, or rejects with `message` once `ms` have passed. */
async function withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

function renderUrl(origin: string, { target, camera, width, height }: RenderRequest): string {
  const url = new URL('/', origin);
  url.searchParams.set('op', 'render');
  url.searchParams.set('target', target.type);
  url.searchParams.set('name', target.name);
  url.searchParams.set('w', String(width));
  url.searchParams.set('h', String(height));
  url.searchParams.set('camera', camera.type);
  if (camera.type === 'custom') {
    camera.position.forEach((v, i) => url.searchParams.set(`p${'xyz'[i]}`, String(v)));
    camera.lookAt.forEach((v, i) => url.searchParams.set(`t${'xyz'[i]}`, String(v)));
  }
  return url.toString();
}

/** `launchServer` ignores `options.timeout`, so only the connection is bounded here; the caller bounds the launch. */
async function launchChromium(options: LaunchOptions & { timeout: number }): Promise<ChromiumProcess> {
  const deadline = Date.now() + options.timeout;
  const { chromium } = await import('playwright-core');
  // A server, not `launch()`, so a browser that never exits can still be killed.
  const server = await chromium.launchServer(options);
  try {
    const browser = await chromium.connect(server.wsEndpoint(), { timeout: Math.max(1, deadline - Date.now()) });
    return { browser, close: () => server.close(), kill: () => server.kill() };
  } catch (err) {
    await server.kill();
    throw err;
  }
}

/** Playwright waits are unbounded (`timeout: 0`): the caller's one deadline covers them all. */
async function capture(browser: ChromiumProcess['browser'], origin: string, request: RenderRequest): Promise<RenderResult> {
  const context = await browser.newContext({
    viewport: { width: request.width, height: request.height },
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
  });
  // Documents name their own asset URLs, so only the studio may be fetched from this server-side browser.
  const studioOrigin = new URL(origin).origin;
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === studioOrigin ? route.continue() : route.abort('blockedbyclient'),
  );
  await context.routeWebSocket((url) => url.host !== new URL(origin).host, (ws) => ws.close());
  const page = await context.newPage();
  await page.goto(renderUrl(origin, request), { waitUntil: 'domcontentloaded', timeout: 0 });
  const settled = await page.waitForFunction(
    () => {
      const { __officexrRenderReady: ready, __officexrRenderError: error } = globalThis as unknown as RenderSentinels;
      return ready || error !== undefined ? { ready, error } : null;
    },
    undefined,
    { timeout: 0, polling: 100 },
  );
  const { ready, error } = (await settled.jsonValue()) as { ready?: RenderReady; error?: string };
  if (!ready) {
    throw new Error(`render failed: ${error}`);
  }
  const png = await page.locator('canvas').first().screenshot({ type: 'png', timeout: 0 });
  return { png, ...ready };
}

async function stop(chromium: ChromiumProcess, graceMs: number): Promise<void> {
  const closed = await withDeadline(chromium.close(), graceMs, 'close timed out').then(
    () => true,
    () => false,
  );
  if (!closed) {
    await withDeadline(chromium.kill(), graceMs, 'kill timed out').catch((err) => {
      console.error('[studio-mcp] leaked a Chromium process:', err);
    });
  }
}

/** Headless Chromium via `playwright-core`, loaded on first use so importing this module costs nothing. */
export function createChromiumRenderer({
  executablePath,
  timeoutMs = 45_000,
  closeGraceMs = 3_000,
  launch = launchChromium,
}: ChromiumRendererOptions = {}): ViewRenderer {
  const budgetMs = timeoutMs - closeGraceMs;
  return {
    async render(origin, request) {
      const deadline = Date.now() + budgetMs;
      const launching = launch({
        executablePath,
        args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        timeout: budgetMs,
      });
      const chromium = await withDeadline(launching, budgetMs, `no response after ${budgetMs / 1000} s`).catch((err) => {
        console.error('[studio-mcp] Chromium launch failed:', err);
        // A Chromium that comes up after the deadline would otherwise outlive this render.
        void launching.then((late) => late.kill(), () => {});
        throw new Error(`could not start Chromium (${executablePath ?? "Playwright's default"}): ${firstLine(err)}`);
      });
      try {
        return await withDeadline(
          capture(chromium.browser, origin, request),
          deadline - Date.now(),
          `render timed out after ${budgetMs / 1000} s`,
        );
      } catch (err) {
        console.error('[studio-mcp] render failed:', err);
        throw new Error(firstLine(err));
      } finally {
        await stop(chromium, closeGraceMs);
      }
    },
  };
}
