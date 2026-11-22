import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

export const HOLIDAY_PACK_ID = 'holiday';
export const HOLIDAY_PACK_DIR = 'Kenney_Holiday_Kit_2.0';
export const HOLIDAY_SWATCH = '#c81e3a';
export const HOLIDAY_SCALE = 1.5;
const TEXTURE = 'colormap.png';
const KENNEY_PAGE = 'https://kenney.nl/assets/holiday-kit';
const KENNEY_DOWNLOAD_ID = '6173736574732f686f6c696461792d6b6974';
const CLIENT = 'research-bot/1.0 (pass.unhealthy504@passmail.com)';

export const HOLIDAY_OBJECTS: ReadonlyArray<{ file: string; label: string }> = [
  { file: 'tree-decorated', label: 'Christmas tree' },
  { file: 'tree-decorated-snow', label: 'Snowy Christmas tree' },
  { file: 'tree', label: 'Pine tree' },
  { file: 'tree-snow-a', label: 'Snowy pine tree' },
  { file: 'present-a-cube', label: 'Gift' },
  { file: 'present-a-rectangle', label: 'Gift, long' },
  { file: 'present-a-round', label: 'Gift, round' },
  { file: 'present-b-cube', label: 'Gift, green' },
  { file: 'present-b-round', label: 'Gift, green round' },
  { file: 'snowman', label: 'Snowman' },
  { file: 'snowman-hat', label: 'Snowman with hat' },
  { file: 'candy-cane-red', label: 'Candy cane' },
  { file: 'candy-cane-green', label: 'Candy cane, green' },
  { file: 'lights-colored', label: 'String lights' },
  { file: 'lights-red', label: 'String lights, red' },
  { file: 'lights-green', label: 'String lights, green' },
  { file: 'wreath', label: 'Wreath' },
  { file: 'wreath-decorated', label: 'Decorated wreath' },
  { file: 'nutcracker', label: 'Nutcracker' },
  { file: 'reindeer', label: 'Reindeer' },
  { file: 'sled', label: 'Sled' },
  { file: 'sock-red', label: 'Stocking' },
  { file: 'sock-green', label: 'Stocking, green' },
  { file: 'gingerbread-man', label: 'Gingerbread man' },
  { file: 'lantern', label: 'Lantern' },
  { file: 'snowflake-a', label: 'Snowflake' },
  { file: 'snow-pile', label: 'Snow pile' },
];

export interface Bounds {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

interface GltfNode {
  children?: number[];
  mesh?: number;
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

interface Gltf {
  scene?: number;
  scenes: Array<{ nodes: number[] }>;
  nodes: GltfNode[];
  meshes: Array<{ primitives: Array<{ attributes: { POSITION: number } }> }>;
  accessors: Array<{ min?: number[]; max?: number[] }>;
  buffers: Array<{ byteLength: number; uri?: string }>;
  images?: Array<{ uri?: string }>;
}

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

function parseGlb(glb: Buffer): { json: Gltf; bin: Buffer } {
  if (glb.readUInt32LE(0) !== GLB_MAGIC) throw new Error('not a GLB file');
  let json: Gltf | null = null;
  let bin = Buffer.alloc(0);
  for (let off = 12; off < glb.length; ) {
    const len = glb.readUInt32LE(off);
    const type = glb.readUInt32LE(off + 4);
    const body = glb.subarray(off + 8, off + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(body.toString('utf8')) as Gltf;
    else if (type === CHUNK_BIN) bin = Buffer.from(body);
    off += 8 + len;
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, bin };
}

type Mat = number[];
const IDENTITY: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Mat, b: Mat): Mat {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

function localMatrix(n: GltfNode): Mat {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

export function gltfBounds(gltf: Gltf): Bounds {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const visit = (index: number, parent: Mat): void => {
    const node = gltf.nodes[index];
    const world = multiply(parent, localMatrix(node));
    if (node.mesh !== undefined) {
      for (const prim of gltf.meshes[node.mesh].primitives) {
        const acc = gltf.accessors[prim.attributes.POSITION];
        if (!acc.min || !acc.max) throw new Error('POSITION accessor has no min/max');
        for (let corner = 0; corner < 8; corner++) {
          const p = [0, 1, 2].map((i) => (corner & (1 << i) ? acc.max![i] : acc.min![i]));
          const wx = world[0] * p[0] + world[4] * p[1] + world[8] * p[2] + world[12];
          const wy = world[1] * p[0] + world[5] * p[1] + world[9] * p[2] + world[13];
          const wz = world[2] * p[0] + world[6] * p[1] + world[10] * p[2] + world[14];
          min.x = Math.min(min.x, wx); max.x = Math.max(max.x, wx);
          min.y = Math.min(min.y, wy); max.y = Math.max(max.y, wy);
          min.z = Math.min(min.z, wz); max.z = Math.max(max.z, wz);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const root of gltf.scenes[gltf.scene ?? 0].nodes) visit(root, IDENTITY);
  return { min, max };
}

const round = (v: number): number => Math.round(v * 1e4) / 1e4;

export function roundedBounds(b: Bounds): Bounds {
  return {
    min: { x: round(b.min.x), y: round(b.min.y), z: round(b.min.z) },
    max: { x: round(b.max.x), y: round(b.max.y), z: round(b.max.z) },
  };
}

export function convertGlb(glb: Buffer, name: string, scale: number): { gltf: Gltf; bin: Buffer } {
  const { json, bin } = parseGlb(glb);
  const scene = json.scenes[json.scene ?? 0];
  json.nodes.push({ children: scene.nodes, scale: [scale, scale, scale] });
  scene.nodes = [json.nodes.length - 1];
  json.buffers[0].uri = `${name}.bin`;
  for (const image of json.images ?? []) image.uri = TEXTURE;
  return { gltf: json, bin };
}

export async function writeHolidayPack(extractedKit: string, outRoot: string): Promise<string[]> {
  const glbDir = join(extractedKit, 'Models', 'GLB format');
  const dest = join(outRoot, HOLIDAY_PACK_DIR);
  await mkdir(dest, { recursive: true });
  const written: string[] = [];
  for (const { file } of HOLIDAY_OBJECTS) {
    const { gltf, bin } = convertGlb(await readFile(join(glbDir, `${file}.glb`)), file, HOLIDAY_SCALE);
    await writeFile(join(dest, `${file}.gltf`), JSON.stringify(gltf) + '\n');
    await writeFile(join(dest, `${file}.bin`), bin);
    written.push(`${file}.gltf`);
  }
  await copyFile(join(glbDir, 'Textures', TEXTURE), join(dest, TEXTURE));
  await copyFile(join(extractedKit, 'License.txt'), join(dest, 'License.txt'));
  return written;
}

export async function holidayBounds(gltfPath: string): Promise<Bounds> {
  return roundedBounds(gltfBounds(JSON.parse(await readFile(gltfPath, 'utf8')) as Gltf));
}

export function holidayLabel(gltfPath: string): string | undefined {
  const stem = basename(gltfPath).replace(/\.gltf$/i, '');
  return HOLIDAY_OBJECTS.find((o) => o.file === stem)?.label;
}

export async function downloadKenneyKit(dest: string): Promise<void> {
  const headers = { 'user-agent': CLIENT, referer: KENNEY_PAGE };
  const linkRes = await fetch(`https://kenney.nl/download-link/${KENNEY_DOWNLOAD_ID}`, { headers });
  if (!linkRes.ok) throw new Error(`kenney download link: ${linkRes.status}`);
  const { url } = (await linkRes.json()) as { url?: string };
  if (!url) throw new Error('kenney download link: no url in response');
  const zipRes = await fetch(url, { headers });
  if (!zipRes.ok) throw new Error(`kenney download ${url}: ${zipRes.status}`);
  await writeFile(dest, Buffer.from(await zipRes.arrayBuffer()));
}

export async function assertCc0(extractedKit: string): Promise<void> {
  const licence = join(extractedKit, 'License.txt');
  if (!existsSync(licence) || !/Creative Commons Zero, CC0/.test(await readFile(licence, 'utf8'))) {
    throw new Error('holiday kit: License.txt is missing or is not CC0; refusing to install');
  }
}

export async function listFiles(dir: string): Promise<string[]> {
  return (await readdir(dir)).sort();
}
