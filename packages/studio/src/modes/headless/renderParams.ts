import { isValidSceneName } from '@officexr/world/scenes';

export type Vec3 = readonly [number, number, number];

export type RenderTarget = 'map' | 'room' | 'layout';

export type CameraSpec =
  | { type: 'top' }
  | { type: 'iso' }
  /** `target` defaults to the centre of the scene bounds. */
  | { type: 'custom'; position: Vec3; target?: Vec3 };

export interface RenderParams {
  target: RenderTarget;
  name: string;
  camera: CameraSpec;
  width: number;
  height: number;
}

export type ParsedRenderParams =
  | { ok: true; params: RenderParams }
  | { ok: false; error: string };

const TARGETS: readonly RenderTarget[] = ['map', 'room', 'layout'];
const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 768;
const MIN_SIZE = 16;
const MAX_SIZE = 4096;

type Parsed<T> = { value: T } | { error: string };

function parseNumber(search: URLSearchParams, key: string): Parsed<number | undefined> {
  const raw = search.get(key);
  if (raw === null) {
    return { value: undefined };
  }
  const value = raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(value) ? { value } : { error: `${key} must be a finite number, got "${raw}"` };
}

/** Reads `<prefix>x/y/z`; all three must be present or none. */
function parseVec3(search: URLSearchParams, prefix: 'p' | 't'): Parsed<Vec3 | undefined> {
  const axes: number[] = [];
  for (const axis of ['x', 'y', 'z']) {
    const n = parseNumber(search, `${prefix}${axis}`);
    if ('error' in n) {
      return n;
    }
    if (n.value !== undefined) {
      axes.push(n.value);
    }
  }
  if (axes.length === 0) {
    return { value: undefined };
  }
  return axes.length === 3
    ? { value: [axes[0], axes[1], axes[2]] }
    : { error: `${prefix}x, ${prefix}y and ${prefix}z must be given together` };
}

function parseSize(search: URLSearchParams, key: 'w' | 'h', fallback: number): Parsed<number> {
  const n = parseNumber(search, key);
  if ('error' in n) {
    return n;
  }
  const value = n.value ?? fallback;
  return Number.isInteger(value) && value >= MIN_SIZE && value <= MAX_SIZE
    ? { value }
    : { error: `${key} must be an integer in ${MIN_SIZE}..${MAX_SIZE}, got ${value}` };
}

function parseCamera(search: URLSearchParams): Parsed<CameraSpec> {
  const type = search.get('camera') ?? 'iso';
  if (type === 'top' || type === 'iso') {
    return { value: { type } };
  }
  if (type !== 'custom') {
    return { error: `camera must be top, iso or custom, got "${type}"` };
  }
  const position = parseVec3(search, 'p');
  if ('error' in position) {
    return position;
  }
  if (!position.value) {
    return { error: 'camera=custom needs px, py and pz' };
  }
  const target = parseVec3(search, 't');
  return 'error' in target ? target : { value: { type, position: position.value, target: target.value } };
}

/** Parses the `?op=render` query into validated render parameters. */
export function parseRenderParams(search: URLSearchParams): ParsedRenderParams {
  const target = search.get('target');
  if (!TARGETS.includes(target as RenderTarget)) {
    return { ok: false, error: `target must be one of ${TARGETS.join(', ')}, got "${target ?? ''}"` };
  }
  const name = search.get('name') ?? '';
  if (!isValidSceneName(name)) {
    return { ok: false, error: `invalid name "${name}"` };
  }
  const camera = parseCamera(search);
  if ('error' in camera) {
    return { ok: false, error: camera.error };
  }
  const width = parseSize(search, 'w', DEFAULT_WIDTH);
  if ('error' in width) {
    return { ok: false, error: width.error };
  }
  const height = parseSize(search, 'h', DEFAULT_HEIGHT);
  if ('error' in height) {
    return { ok: false, error: height.error };
  }
  return {
    ok: true,
    params: { target: target as RenderTarget, name, camera: camera.value, width: width.value, height: height.value },
  };
}
