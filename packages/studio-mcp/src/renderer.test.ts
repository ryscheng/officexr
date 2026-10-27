import { describe, expect, it } from 'vitest';
import { createChromiumRenderer, type ChromiumProcess, type RenderRequest } from './renderer.ts';

const ORIGIN = 'http://127.0.0.1:5174';
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const REQUEST: RenderRequest = {
  target: { type: 'room', name: 'hall' },
  camera: { type: 'custom', position: [1, 2, 3], lookAt: [0, 0, 0] },
  width: 320,
  height: 240,
};

type RouteHandler = (route: unknown) => Promise<string>;
const never = () => new Promise<never>(() => {});

/** Stands in for a launched Chromium; each step can be swapped to hang or fail. */
class FakeChromium implements ChromiumProcess {
  urls: string[] = [];
  routeHandler?: RouteHandler;
  sentinel: { ready?: object; error?: string } = { ready: { bounds: { min: [0, 0, 0], max: [1, 1, 1] } } };
  goto: () => Promise<unknown> = async () => null;
  closed = false;
  killed = false;
  close: () => Promise<void> = async () => {
    this.closed = true;
  };
  kill = async () => {
    this.killed = true;
  };
  browser = {
    newContext: async () => ({
      route: async (_pattern: string, handler: RouteHandler) => {
        this.routeHandler = handler;
      },
      newPage: async () => ({
        goto: (url: string) => {
          this.urls.push(url);
          return this.goto();
        },
        waitForFunction: async () => ({ jsonValue: async () => this.sentinel }),
        locator: () => ({ first: () => ({ screenshot: async () => PNG_BYTES }) }),
      }),
    }),
  } as unknown as ChromiumProcess['browser'];
}

function rendererWith(chromium: FakeChromium, timeoutMs = 300) {
  return createChromiumRenderer({ timeoutMs, closeGraceMs: 50, launch: async () => chromium });
}

describe('createChromiumRenderer', () => {
  it('loads the render page from the studio origin and returns the canvas PNG', async () => {
    const chromium = new FakeChromium();
    const result = await rendererWith(chromium).render(ORIGIN, REQUEST);

    expect(result).toEqual({ png: PNG_BYTES, bounds: { min: [0, 0, 0], max: [1, 1, 1] } });
    expect(new URL(chromium.urls[0]).origin).toBe(ORIGIN);
    expect(Object.fromEntries(new URL(chromium.urls[0]).searchParams)).toEqual({
      op: 'render',
      target: 'room',
      name: 'hall',
      w: '320',
      h: '240',
      camera: 'custom',
      px: '1',
      py: '2',
      pz: '3',
      tx: '0',
      ty: '0',
      tz: '0',
    });
    expect([chromium.closed, chromium.killed]).toEqual([true, false]);
  });

  it('lets the browser fetch only from the studio origin', async () => {
    const chromium = new FakeChromium();
    await rendererWith(chromium).render(ORIGIN, REQUEST);
    const decide = (url: string) =>
      chromium.routeHandler!({
        request: () => ({ url: () => url }),
        continue: async () => 'continue',
        abort: async (reason: string) => `abort ${reason}`,
      });

    expect(await decide(`${ORIGIN}/models/blocks/a.glb`)).toBe('continue');
    expect(await decide(`${ORIGIN}/api/baked-layouts/hall`)).toBe('continue');
    for (const url of [
      'http://10.0.0.5/secret.glb',
      'http://127.0.0.1:8787/health',
      'https://127.0.0.1:5174/models/a.glb',
      'http://localhost:5174/models/a.glb',
      'https://cdn.example.com/a.glb',
    ]) {
      expect(await decide(url)).toBe('abort blockedbyclient');
    }
  });

  it('reports the page error sentinel and still closes the browser', async () => {
    const chromium = new FakeChromium();
    chromium.sentinel = { error: 'room "hall" has nothing to render' };
    await expect(rendererWith(chromium).render(ORIGIN, REQUEST)).rejects.toThrow(
      'render failed: room "hall" has nothing to render',
    );
    expect(chromium.closed).toBe(true);
  });

  it('trims a multi-line Playwright error to its first line', async () => {
    const chromium = new FakeChromium();
    chromium.goto = async () => {
      throw new Error('page.goto: net::ERR_CONNECTION_REFUSED\nCall log:\n  - navigating to "http://127.0.0.1:1/"');
    };
    await expect(rendererWith(chromium).render(ORIGIN, REQUEST)).rejects.toThrow(
      /^page\.goto: net::ERR_CONNECTION_REFUSED$/,
    );
  });

  it('gives up on a hung page within the budget and closes the browser', async () => {
    const chromium = new FakeChromium();
    chromium.goto = never;
    const started = Date.now();
    await expect(rendererWith(chromium, 300).render(ORIGIN, REQUEST)).rejects.toThrow('render timed out after 0.25 s');
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(chromium.closed).toBe(true);
  });

  it('kills a browser that does not close in time', async () => {
    const chromium = new FakeChromium();
    chromium.close = never;
    await rendererWith(chromium).render(ORIGIN, REQUEST);
    expect(chromium.killed).toBe(true);
  });

  it('names the Chromium it tried when the launch fails', async () => {
    const renderer = createChromiumRenderer({
      executablePath: '/opt/chrome',
      launch: async () => {
        throw new Error("Failed to launch: Executable doesn't exist at /opt/chrome\n╔════╗");
      },
    });
    await expect(renderer.render(ORIGIN, REQUEST)).rejects.toThrow(
      /^could not start Chromium \(\/opt\/chrome\): Failed to launch: Executable doesn't exist at \/opt\/chrome$/,
    );
  });
});
