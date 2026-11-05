import type { ViewMode } from '@officexr/sdk';

export type GpuSupport = 'hardware' | 'software' | 'none';

const STORAGE_KEY = 'officexr:viewMode';

/** Probe contexts are discarded straight away; browsers cap the live WebGL contexts. */
export function detectGpu(createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')): GpuSupport {
  const probe = (attributes?: WebGLContextAttributes) => {
    const canvas = createCanvas();
    const gl = canvas.getContext('webgl2', attributes) ?? canvas.getContext('webgl', attributes);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl != null;
  };
  if (probe({ failIfMajorPerformanceCaveat: true })) {
    return 'hardware';
  }
  return probe() ? 'software' : 'none';
}

export function storedViewMode(storage: Pick<Storage, 'getItem'> = localStorage): ViewMode | null {
  try {
    const value = storage.getItem(STORAGE_KEY);
    return value === '2d' || value === '3d' ? value : null;
  } catch {
    return null;
  }
}

export function storeViewMode(mode: ViewMode, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, mode);
  } catch {
    // Unremembered choice: the reload falls back to detection.
  }
}

export function initialViewMode(gpu: GpuSupport, stored: ViewMode | null): ViewMode {
  if (gpu === 'none') {
    return '2d';
  }
  return stored ?? (gpu === 'hardware' ? '3d' : '2d');
}
