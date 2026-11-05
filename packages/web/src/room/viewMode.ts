import type { ViewMode } from '@officexr/sdk';

export type GpuSupport = 'hardware' | 'software' | 'none';

const STORAGE_KEY = 'officexr:viewMode';

/** 'hardware': WebGL without a performance caveat; 'software': only a slow fallback renderer; 'none': no WebGL.
 * Probe contexts are discarded straight away; browsers cap the live WebGL contexts. */
export function detectGpu(createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')): GpuSupport {
  // A canvas keeps the first context type it was asked for, so each attempt needs its own.
  const attempt = (type: 'webgl2' | 'webgl', attributes?: WebGLContextAttributes) => {
    const gl = createCanvas().getContext(type, attributes) as WebGLRenderingContext | null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl != null;
  };
  const probe = (attributes?: WebGLContextAttributes) => attempt('webgl2', attributes) || attempt('webgl', attributes);
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
