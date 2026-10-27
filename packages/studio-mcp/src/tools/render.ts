import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { HeavyWorkLock } from '../heavy-work-lock.ts';
import type { ViewRenderer } from '../renderer.ts';
import type { StudioDocuments } from '../studio-documents.ts';
import { checkedName, nameSchema } from './documents.ts';
import { errorResult, guard } from './shared.ts';

const MAX_SIZE = 1024;
const DEFAULT_SIZE = 768;

const point = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const size = (axis: string) =>
  z.number().int().min(16).max(MAX_SIZE).default(DEFAULT_SIZE).describe(`Image ${axis} in pixels, 16 to ${MAX_SIZE}.`);

const camera = z.union([
  z.literal('top'),
  z.literal('iso'),
  z
    .object({ position: point, lookAt: point })
    .strict()
    .refine(({ position, lookAt }) => position.some((v, i) => v !== lookAt[i]), {
      message: 'camera.position and camera.lookAt must differ',
    }),
]);

export function registerRenderTools(
  server: McpServer,
  { maps, rooms, layouts }: StudioDocuments,
  origin: string,
  renderer: ViewRenderer,
  lock: HeavyWorkLock,
): void {
  const stores = { map: maps, room: rooms, layout: layouts };
  server.registerTool(
    'render_view',
    {
      description:
        'Render a stored map, room or layout to a PNG so you can check what you authored. ' +
        'target is {type: "map"|"room"|"layout", name}; a room is drawn with its baked layout if it has one. ' +
        'camera is "top" (orthographic, straight down, -Z at the top of the image, framed on the whole scene with a ' +
        '1 m margin), "iso" (perspective from the +X/+Z side at 35 degrees elevation, framed on the whole scene), ' +
        'or {position: [x, y, z], lookAt: [x, y, z]} in world metres for a perspective view (45 degree vertical field of view; ' +
        'y is up; near 0.1 m, far 2000 m). Voxel coordinates are 0.5 m, so metres = voxels * 0.5. ' +
        'The scene sits on a 1 m grid at y = 0, for a sense of scale. ' +
        `width and height default to ${DEFAULT_SIZE} and cap at ${MAX_SIZE}. ` +
        'Returns the image and a text block with the target, the camera, the scene bounds ({min, max} in metres) ' +
        'and, for the top camera, metresPerPixel. Slow (several seconds); only one bake or render runs at a time, ' +
        'so retry if it reports one in progress.',
      inputSchema: {
        target: z.object({ type: z.enum(['map', 'room', 'layout']), name: nameSchema }).strict(),
        camera,
        width: size('width'),
        height: size('height'),
      },
    },
    ({ target, camera, width, height }) =>
      guard(async () => {
        checkedName(target.name);
        if (!(await stores[target.type].load(target.name))) {
          return errorResult(`${target.type} "${target.name}" not found`);
        }
        const { png, bounds, metresPerPixel } = await lock.run(() =>
          renderer.render(origin, { target, camera, width, height }),
        );
        const info = { target, camera, width, height, bounds, metresPerPixel };
        return {
          content: [
            { type: 'image', data: Buffer.from(png).toString('base64'), mimeType: 'image/png' },
            { type: 'text', text: JSON.stringify(info, null, 2) },
          ],
        };
      }),
  );
}
