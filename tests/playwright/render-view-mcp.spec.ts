/**
 * `render_view` over the studio dev server's `POST /mcp`: the tool launches its own
 * headless Chromium against the dev server's `?op=render` page and returns a PNG.
 * Documents are written through the same endpoint, into the suite's scratch data dir, and
 * deleted afterwards in case the run reused a developer's dev server.
 */

import { expect, test, type APIRequestContext } from '@playwright/test';
import { PNG } from 'pngjs';

const PREFIX = 'e2e-render-view';
const ROOM = `${PREFIX}-room`;
const MAP = `${PREFIX}-map`;
const EMPTY_ROOM = `${PREFIX}-empty`;

const blueBlock = (id: string, position: number[]) => ({ id, op: 'placeObject', kindId: '__primitive_blue', position });
const room = (name: string, commands: object[]) => ({ schemaVersion: 5, name, title: name, updatedAt: 0, commands, groups: {} });
const roomDoc = room(ROOM, [blueBlock('b1', [0, 0, 0]), blueBlock('b2', [4, 0, 0])]);
const mapDoc = {
  schemaVersion: 2,
  name: MAP,
  title: MAP,
  updatedAt: 0,
  rooms: [{ id: 'r1', roomName: ROOM, position: [0, 0, 0], rotationY: 0 }],
  spawnPoints: [],
  environment: {
    sun: { positionX: 20, positionY: 40, positionZ: 20, color: '#ffffff', intensity: 1.4 },
    sky: null,
    stars: null,
    hdri: null,
    ambientIntensity: 0.15,
  },
};

interface ToolResult {
  isError?: boolean;
  content: { type: string; text?: string; data?: string; mimeType?: string }[];
}

let nextId = 1;
const mcp = async (request: APIRequestContext, name: string, args: object): Promise<ToolResult> => {
  const response = await request.post('/mcp', {
    headers: { accept: 'application/json, text/event-stream' },
    timeout: 60_000,
    data: { jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).result;
};

const isBlue = (r: number, g: number, b: number) => b - r > 40 && b - g > 40;
const countBlue = (png: PNG) => {
  let count = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    count += isBlue(png.data[i], png.data[i + 1], png.data[i + 2]) ? 1 : 0;
  }
  return count;
};

test.describe.configure({ mode: 'serial' });
test.setTimeout(90_000);

test.beforeAll(async ({ request }) => {
  expect((await mcp(request, 'put_room', { name: ROOM, room: roomDoc })).isError).toBeFalsy();
  expect((await mcp(request, 'put_map', { name: MAP, map: mapDoc })).isError).toBeFalsy();
  expect((await mcp(request, 'put_room', { name: EMPTY_ROOM, room: room(EMPTY_ROOM, []) })).isError).toBeFalsy();
});

test.afterAll(async ({ request }) => {
  await mcp(request, 'delete_map', { name: MAP });
  await mcp(request, 'delete_room', { name: ROOM });
  await mcp(request, 'delete_room', { name: EMPTY_ROOM });
});

const CAMERAS: Array<[string, unknown]> = [
  ['top', 'top'],
  ['iso', 'iso'],
  ['custom', { position: [3, 8, 12], lookAt: [3, 1, 1] }],
];

for (const [targetType, name] of [['map', MAP], ['room', ROOM]]) {
  for (const [cameraLabel, camera] of CAMERAS) {
    test(`renders the ${targetType} from the ${cameraLabel} camera`, async ({ request }) => {
      const result = await mcp(request, 'render_view', { target: { type: targetType, name }, camera, width: 320, height: 240 });
      expect(result.isError).toBeFalsy();

      const image = result.content.find((c) => c.type === 'image')!;
      expect(image.mimeType).toBe('image/png');
      const png = PNG.sync.read(Buffer.from(image.data!, 'base64'));
      expect([png.width, png.height]).toEqual([320, 240]);
      expect(countBlue(png)).toBeGreaterThan(50);

      const info = JSON.parse(result.content.find((c) => c.type === 'text')!.text!);
      expect(info.bounds.max[0]).toBeGreaterThan(info.bounds.min[0]);
      expect(info.metresPerPixel !== undefined).toBe(cameraLabel === 'top');
    });
  }
}

test('an unknown document is a tool error', async ({ request }) => {
  const result = await mcp(request, 'render_view', { target: { type: 'map', name: `${PREFIX}-nowhere` }, camera: 'top' });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain('not found');
});

test('a page error comes back as a tool error', async ({ request }) => {
  const result = await mcp(request, 'render_view', { target: { type: 'room', name: EMPTY_ROOM }, camera: 'iso' });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toBe(`render failed: room "${EMPTY_ROOM}" has nothing to render`);
});
