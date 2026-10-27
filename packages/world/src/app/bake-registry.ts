/**
 * Module-level BakeRegistry — owns "bake of layout X is pending / in-flight /
 * settled" state independent of any React component lifecycle.
 *
 * CONTRACT
 * --------
 * - Zero imports from `three`, `react`, or any DOM API.
 * - Pure JS / Promise-based; state resets on page reload.
 * - Uses `globalThis.setTimeout` / `clearTimeout` for platform portability.
 */

import { bakeLayout } from './layout-bake-service.ts';
import type { KindLookup } from './layout-bake-service.ts';
import type { InstanceGeometryService } from './types.ts';
import type { LayoutDocument } from '../scenes/layout-document.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BakeResult {
  /** Name of the layout that was baked. */
  layoutName: string;
  /** Server path for the stored GLB, e.g. `/api/baked-layouts/foo`. */
  path: string;
  /** Raw GLB bytes. */
  blob: Uint8Array;
  /** Monotonic version counter for this layout (increments on each success). */
  version: number;
}

export interface BakeDeps {
  kindLookup: KindLookup;
  gltfLoader: (url: string) => Promise<Uint8Array>;
  /**
   * Persist the baked GLB (PUT to `/api/baked-layouts/:name`).
   * Injected so tests can run without a network.
   */
  publish: (layoutName: string, glb: Uint8Array) => Promise<void>;
  /**
   * Canonical voxel→world transform service. Shared with the runtime
   * renderer (`<ObjectInstances>` consumes the same instance) so the
   * bake produces meshes at exactly the positions the renderer expects.
   */
  geometry: InstanceGeometryService;
}

export type BakeState = 'idle' | 'pending' | 'running' | 'settled' | 'error';

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface RegistryEntry {
  timeout?: ReturnType<typeof setTimeout>;
  inFlight?: Promise<BakeResult>;
  version: number;
  lastError?: Error;
  /** Most-recent doc snapshot, kept so a queued bake can use the latest. */
  latestDoc?: LayoutDocument;
  /** Deps captured when scheduleBake was last called. */
  latestDeps?: BakeDeps;
  state: BakeState;
}

const registry = new Map<string, RegistryEntry>();
type Listener = (layoutName: string, state: BakeState) => void;
const listeners = new Set<Listener>();

const DEBOUNCE_MS = 1500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getOrCreate(layoutName: string): RegistryEntry {
  let entry = registry.get(layoutName);
  if (!entry) {
    entry = { version: 0, state: 'idle' };
    registry.set(layoutName, entry);
  }
  return entry;
}

function notify(layoutName: string, state: BakeState): void {
  for (const listener of listeners) {
    try {
      listener(layoutName, state);
    } catch {
      // Swallow listener errors so one bad subscriber can't break the pipeline.
    }
  }
}

function setState(entry: RegistryEntry, layoutName: string, state: BakeState): void {
  entry.state = state;
  notify(layoutName, state);
}

/**
 * Execute a bake immediately (no debounce) using the given doc + deps.
 * Returns the in-flight `Promise<BakeResult>` and stores it on `entry.inFlight`.
 */
function startBake(
  layoutName: string,
  doc: LayoutDocument,
  deps: BakeDeps,
  entry: RegistryEntry,
): Promise<BakeResult> {
  setState(entry, layoutName, 'running');

  const promise: Promise<BakeResult> = (async () => {
    try {
      const result = await bakeLayout(doc, deps.kindLookup, deps.gltfLoader, deps.geometry, { optimizer: doc.optimizer });
      await deps.publish(layoutName, result.glb);

      entry.version += 1;
      entry.inFlight = undefined;
      entry.lastError = undefined;
      setState(entry, layoutName, 'settled');

      const bakeResult: BakeResult = {
        layoutName,
        path: `/api/baked-layouts/${layoutName}`,
        blob: result.glb,
        version: entry.version,
      };
      return bakeResult;
    } catch (err) {
      entry.inFlight = undefined;
      entry.lastError = err instanceof Error ? err : new Error(String(err));
      setState(entry, layoutName, 'error');
      throw err;
    }
  })();

  entry.inFlight = promise;
  // No-op catch: prevents unhandled-rejection warnings for callers that only
  // poll getBakeState() instead of awaiting the promise directly.
  promise.catch(() => undefined);
  return promise;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Schedule a bake for `layoutName` after a 1500 ms debounce window.
 * Multiple calls within the window collapse to a single bake using the most
 * recent `doc` snapshot.  Clears any previous error state.
 */
export function scheduleBake(
  layoutName: string,
  doc: LayoutDocument,
  deps: BakeDeps,
): void {
  const entry = getOrCreate(layoutName);

  // Store the latest doc + deps so the debounced timer uses the most recent.
  entry.latestDoc = doc;
  entry.latestDeps = deps;
  entry.lastError = undefined;

  // Cancel any pending timer.
  if (entry.timeout !== undefined) {
    clearTimeout(entry.timeout);
    entry.timeout = undefined;
  }

  setState(entry, layoutName, 'pending');

  entry.timeout = setTimeout(async () => {
    entry.timeout = undefined;
    const latest = entry.latestDoc;
    const latestDeps = entry.latestDeps;
    if (!latest || !latestDeps) return;

    if (entry.inFlight) {
      // A bake is already running.  Wait for it, then re-bake with the newest
      // doc if something changed while it was in flight.
      try { await entry.inFlight; } catch { /* error already recorded */ }
      // Re-bake only if we still have a pending doc (could have been cancelled
      // or superseded while we waited).
      if (entry.latestDoc && entry.latestDoc !== latest) {
        startBake(layoutName, entry.latestDoc, latestDeps, entry);
      }
    } else {
      startBake(layoutName, latest, latestDeps, entry);
    }
  }, DEBOUNCE_MS);
}

/**
 * Return the current in-flight `Promise<BakeResult>` for `layoutName`, or
 * `null` if no bake is running.
 */
export function getBakePromise(layoutName: string): Promise<BakeResult> | null {
  return registry.get(layoutName)?.inFlight ?? null;
}

/**
 * Return an existing in-flight bake promise if one exists, otherwise
 * immediately start a fresh bake (no debounce) and return that promise.
 *
 * Useful for callers that need the GLB right now (e.g. during initial load).
 *
 * Design note: we create and store the `inFlight` promise synchronously
 * (before the async `docFetcher` resolves) so that concurrent calls always
 * see the same promise rather than spawning two independent bakes.
 */
export function awaitFresh(
  layoutName: string,
  deps: BakeDeps,
  docFetcher: () => Promise<LayoutDocument>,
): Promise<BakeResult> {
  const entry = getOrCreate(layoutName);

  if (entry.inFlight) {
    return entry.inFlight;
  }

  // Cancel any pending debounce — we're going to bake right now.
  if (entry.timeout !== undefined) {
    clearTimeout(entry.timeout);
    entry.timeout = undefined;
  }

  // Create the in-flight promise synchronously and store it BEFORE awaiting
  // docFetcher, so any concurrent awaitFresh call will see it and de-dup.
  setState(entry, layoutName, 'running');

  const promise: Promise<BakeResult> = (async () => {
    try {
      const doc = await docFetcher();
      entry.latestDoc = doc;
      entry.latestDeps = deps;

      const result = await bakeLayout(doc, deps.kindLookup, deps.gltfLoader, deps.geometry, { optimizer: doc.optimizer });
      await deps.publish(layoutName, result.glb);

      entry.version += 1;
      entry.inFlight = undefined;
      entry.lastError = undefined;
      setState(entry, layoutName, 'settled');

      return {
        layoutName,
        path: `/api/baked-layouts/${layoutName}`,
        blob: result.glb,
        version: entry.version,
      } satisfies BakeResult;
    } catch (err) {
      entry.inFlight = undefined;
      entry.lastError = err instanceof Error ? err : new Error(String(err));
      setState(entry, layoutName, 'error');
      throw err;
    }
  })();

  entry.inFlight = promise;
  // No-op catch prevents unhandled-rejection warnings for state-poll callers.
  promise.catch(() => undefined);
  return promise;
}

/**
 * Return the current bake version for `layoutName`. Returns `0` if no
 * successful bake has been completed in this session.
 */
export function getVersion(layoutName: string): number {
  return registry.get(layoutName)?.version ?? 0;
}

/**
 * Subscribe to bake-state transitions for any layout.  Returns an
 * unsubscribe function.
 */
export function subscribe(
  listener: (layoutName: string, state: BakeState) => void,
): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Get the current bake state for a layout.
 * Returns `'idle'` if the layout has never been scheduled.
 */
export function getBakeState(layoutName: string): BakeState {
  return registry.get(layoutName)?.state ?? 'idle';
}

/**
 * Snapshot of the in-memory registry: every layout the user has
 * touched in this tab's session, with its latest state + (when
 * available) the last error message. Used by the global bake status
 * bar to show how many bakes are in flight and which layouts they
 * belong to. The result is a NEW array on every call — callers
 * should not mutate it.
 */
export function listAllBakes(): Array<{
  layoutName: string;
  state: BakeState;
  version: number;
  lastError?: string;
}> {
  const out: Array<{
    layoutName: string;
    state: BakeState;
    version: number;
    lastError?: string;
  }> = [];
  for (const [layoutName, entry] of registry) {
    out.push({
      layoutName,
      state: entry.state,
      version: entry.version,
      lastError: entry.lastError?.message,
    });
  }
  return out;
}

/**
 * Clear all registry state. Intended for use in tests only.
 * @internal
 */
export function _resetRegistry(): void {
  for (const entry of registry.values()) {
    if (entry.timeout !== undefined) clearTimeout(entry.timeout);
  }
  registry.clear();
  listeners.clear();
}
