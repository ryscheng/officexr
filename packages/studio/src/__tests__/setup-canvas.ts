import { vi } from 'vitest';

/**
 * jsdom doesn't implement `HTMLCanvasElement.getContext`, so it throws.
 * Some renderer modules build a procedural 2D texture at import time
 * (e.g. `renderer/proximity/BubbleParticles.tsx`'s module-scoped
 * `radialTexture`). Any studio test that transitively imports the
 * renderer barrel — including the Tier 3 editor-scenario tests that
 * mount scene layers under `@react-three/test-renderer` — would crash
 * on load without this stub.
 *
 * We only stub the 2D context (returning a no-op canvas API including
 * `createRadialGradient`); WebGL is handled by the test renderer's own
 * mock GL, so we return null for other context types.
 */
function make2dContextStub(): CanvasRenderingContext2D {
  const gradient = { addColorStop: vi.fn() };
  return {
    fillStyle: '',
    strokeStyle: '',
    globalCompositeOperation: 'source-over',
    lineWidth: 1,
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    createLinearGradient: vi.fn(() => gradient),
    createRadialGradient: vi.fn(() => gradient),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = vi.fn(function getContext(
    type: string,
  ) {
    return type === '2d' ? make2dContextStub() : null;
  }) as unknown as HTMLCanvasElement['getContext'];
}
