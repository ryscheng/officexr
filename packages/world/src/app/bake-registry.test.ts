/**
 * Tests for the BakeRegistry module.
 *
 * Uses Vitest fake timers for deterministic debounce tests.  Each test
 * calls `_resetRegistry()` to wipe module-level state between cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  scheduleBake,
  getBakePromise,
  awaitFresh,
  getVersion,
  subscribe,
  getBakeState,
  _resetRegistry,
} from './bake-registry.ts';
import type { BakeDeps, BakeResult, BakeState } from './bake-registry.ts';
import type { InstanceGeometryService } from './types.ts';

// bakeLayout is mocked below, so the geometry service is never actually
// consulted during these tests. A bare-bones stub satisfies the type
// contract and keeps the mocks focused on registry behaviour.
const stubGeometry: InstanceGeometryService = {
  voxelSize: 0.5,
  worldAABB: () => ({ min: [0, 0, 0], max: [0, 0, 0] }),
  worldAABBOfInstance: () => ({ min: [0, 0, 0], max: [0, 0, 0] }),
  meshOrigin: () => [0, 0, 0],
  voxelFootprint: () => ({ min: [0, 0, 0], max: [0, 0, 0] }),
  tileStep: () => [1, 1, 1],
};
import type { LayoutDocument } from '../scenes/layout-document.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal LayoutDocument fixture. */
function makeDoc(name = 'test-layout'): LayoutDocument {
  return {
    schemaVersion: 1,
    name,
    updatedAt: 0,
    commands: [
      { id: 'c1', op: 'placeObject', kindId: 'wall', position: [0, 0, 0] },
    ],
  };
}

/**
 * Build a `BakeDeps` where `bakeLayout` is replaced by a mock that
 * immediately resolves (by default) or can be controlled via `bakeImpl`.
 */
function makeDeps(
  bakeImpl?: () => Promise<void>,
): BakeDeps & { publishCalls: Array<{ name: string; size: number }> } {
  const publishCalls: Array<{ name: string; size: number }> = [];

  // We mock bakeLayout at the module level via vi.mock, but for these tests
  // we control the bake outcome through the publish function's call count
  // and by using the real bakeLayout (which is already tested) via a simple
  // wrapper that returns a trivial GLB.
  return {
    kindLookup: () => undefined, // kindLookup returning undefined will cause bakeLayout to throw
    gltfLoader: async () => new Uint8Array(0),
    publish: async (name: string, glb: Uint8Array) => {
      publishCalls.push({ name, size: glb.length });
      if (bakeImpl) await bakeImpl();
    },
    geometry: stubGeometry,
    publishCalls,
  };
}

// ---------------------------------------------------------------------------
// Mock bakeLayout so tests don't depend on real GLTF merging
// ---------------------------------------------------------------------------

// We replace bakeLayout at the module level so BakeRegistry always gets our
// controlled version.  We do this BEFORE importing bake-registry so the mock
// is in place when the module initialises.
vi.mock('./layout-bake-service.ts', () => {
  return {
    bakeLayout: vi.fn(async () => ({
      glb: new Uint8Array([1, 2, 3, 4]),
      meta: { kindCount: 1, commandCount: 1 },
    })),
  };
});

// ---------------------------------------------------------------------------
// Helpers that use the mocked bakeLayout
// ---------------------------------------------------------------------------

function goodDeps(
  extra?: { publishImpl?: () => Promise<void> },
): BakeDeps & { publishCalls: Array<{ name: string; size: number }> } {
  const publishCalls: Array<{ name: string; size: number }> = [];
  return {
    kindLookup: (id) => ({
      id,
      label: id,
      gltfPath: `/models/${id}.glb`,
      swatch: '#fff',
      walkable: false,
      scale: 1,
      tint: null,
      opacity: 1,
      roughness: null,
      metalness: null,
      emissive: null,
      emissiveIntensity: 0,
      category: 'block',
      tilingAxes: { x: true, y: true, z: true },
      gravity: false,
      isLayoutObject: true,
      optimization: 'none',
    }),
    gltfLoader: async () => new Uint8Array([0x47, 0x4c, 0x54, 0x46]),
    publish: async (name: string, glb: Uint8Array) => {
      publishCalls.push({ name, size: glb.length });
      if (extra?.publishImpl) await extra.publishImpl();
    },
    geometry: stubGeometry,
    publishCalls,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BakeRegistry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetRegistry();
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetRegistry();
  });

  // -------------------------------------------------------------------------
  // scheduleBake + debounce
  // -------------------------------------------------------------------------

  it('state transitions: idle → pending after scheduleBake', () => {
    expect(getBakeState('room')).toBe('idle');
    const deps = goodDeps();
    scheduleBake('room', makeDoc(), deps);
    expect(getBakeState('room')).toBe('pending');
  });

  it('two scheduleBake calls within 1500ms collapse to one publish', async () => {
    const deps = goodDeps();
    const doc = makeDoc();

    scheduleBake('room', doc, deps);
    scheduleBake('room', doc, deps);

    // Advance past debounce window.
    await vi.runAllTimersAsync();

    expect(deps.publishCalls.length).toBe(1);
  });

  it('getBakePromise is null before the debounce fires', () => {
    const deps = goodDeps();
    scheduleBake('room', makeDoc(), deps);
    expect(getBakePromise('room')).toBeNull();
  });

  it('getBakePromise returns the in-flight promise after debounce fires', async () => {
    const deps = goodDeps();
    scheduleBake('room', makeDoc(), deps);

    // Advance exactly the debounce period.
    vi.advanceTimersByTime(1500);

    expect(getBakePromise('room')).toBeInstanceOf(Promise);
  });

  it('version increments after a successful bake', async () => {
    const deps = goodDeps();
    expect(getVersion('room')).toBe(0);

    scheduleBake('room', makeDoc(), deps);
    await vi.runAllTimersAsync();

    expect(getVersion('room')).toBe(1);
  });

  it('state is settled after successful bake', async () => {
    const deps = goodDeps();
    scheduleBake('room', makeDoc(), deps);
    await vi.runAllTimersAsync();
    expect(getBakeState('room')).toBe('settled');
  });

  it('version increments on each successive bake', async () => {
    const deps = goodDeps();
    const doc = makeDoc();

    scheduleBake('room', doc, deps);
    await vi.runAllTimersAsync();
    expect(getVersion('room')).toBe(1);

    scheduleBake('room', doc, deps);
    await vi.runAllTimersAsync();
    expect(getVersion('room')).toBe(2);
  });

  // -------------------------------------------------------------------------
  // awaitFresh
  // -------------------------------------------------------------------------

  it('awaitFresh starts a bake immediately (no debounce) and resolves', async () => {
    const deps = goodDeps();
    const result = await awaitFresh('room', deps, async () => makeDoc());

    expect(result.layoutName).toBe('room');
    expect(result.version).toBe(1);
    expect(result.blob.length).toBeGreaterThan(0);
    expect(deps.publishCalls.length).toBe(1);
  });

  it('awaitFresh returns the existing in-flight promise when one exists', async () => {
    const deps = goodDeps();
    // Prime an in-flight bake via awaitFresh.
    const p1 = awaitFresh('room', deps, async () => makeDoc());
    // Call again immediately — should get the same promise back.
    const p2 = awaitFresh('room', deps, async () => makeDoc());

    const [r1, r2] = await Promise.all([p1, p2]);
    // Same promise → same version, single publish.
    expect(r1.version).toBe(r2.version);
    expect(deps.publishCalls.length).toBe(1);
  });

  it('awaitFresh cancels pending debounce timer', async () => {
    const deps = goodDeps();
    scheduleBake('room', makeDoc(), deps);
    expect(getBakeState('room')).toBe('pending');

    // awaitFresh should cancel the timer and bake immediately.
    const result = await awaitFresh('room', deps, async () => makeDoc());
    expect(result.version).toBe(1);

    // Advancing timers should not fire another bake (debounce was cancelled).
    await vi.runAllTimersAsync();
    expect(deps.publishCalls.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // subscribe
  // -------------------------------------------------------------------------

  it('subscribe notifies on pending → running → settled transitions', async () => {
    const events: Array<{ layoutName: string; state: BakeState }> = [];
    const unsub = subscribe((layoutName, state) => {
      events.push({ layoutName, state });
    });

    const deps = goodDeps();
    scheduleBake('room', makeDoc(), deps);
    await vi.runAllTimersAsync();

    unsub();

    const states = events.map((e) => e.state);
    expect(states).toContain('pending');
    expect(states).toContain('running');
    expect(states).toContain('settled');
    expect(events.every((e) => e.layoutName === 'room')).toBe(true);
  });

  it('unsubscribing stops notifications', async () => {
    const events: string[] = [];
    const unsub = subscribe((_, state) => events.push(state));
    unsub(); // Immediately unsubscribe.

    const deps = goodDeps();
    scheduleBake('room', makeDoc(), deps);
    await vi.runAllTimersAsync();

    expect(events).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Cross-component / cross-unmount promise survival
  // -------------------------------------------------------------------------

  it('in-flight bake resolves even after the caller loses its reference', async () => {
    // Simulate a React component scheduling a bake then "unmounting" (losing
    // its reference to the deps object).  A later consumer should still be
    // able to await the result via getBakePromise.

    const deps = goodDeps();
    scheduleBake('room', makeDoc(), deps);
    vi.advanceTimersByTime(1500); // Fire the debounce timer.

    const promise = getBakePromise('room');
    expect(promise).not.toBeNull();

    // Advance micro-task queue so the async bake can settle.
    const result = await promise!;
    expect(result.version).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it('bake failure sets state to error', async () => {
    const { bakeLayout } = await import('./layout-bake-service.ts');
    vi.mocked(bakeLayout).mockRejectedValueOnce(new Error('GLTF not found'));

    const deps = goodDeps();
    scheduleBake('room', makeDoc(), deps);
    await vi.runAllTimersAsync();

    expect(getBakeState('room')).toBe('error');
  });

  it('scheduling again after an error clears the error state', async () => {
    const { bakeLayout } = await import('./layout-bake-service.ts');
    vi.mocked(bakeLayout).mockRejectedValueOnce(new Error('transient error'));

    const deps = goodDeps();
    scheduleBake('room', makeDoc(), deps);
    await vi.runAllTimersAsync();
    expect(getBakeState('room')).toBe('error');

    // Second schedule clears the error.
    scheduleBake('room', makeDoc(), deps);
    expect(getBakeState('room')).toBe('pending');
  });
});
