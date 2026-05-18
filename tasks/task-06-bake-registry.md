# Task 06: `BakeRegistry` — debounce and cross-unmount promise

## Objective
A module-level singleton that owns "the bake of layout X is pending / in-flight / settled" state, independent of any React component lifecycle. Debounces schedule calls; lets consumers `await` an in-flight or fresh bake.

## Dependencies
- Task 05 (`bakeLayout` exists).
- Task 04 (`/api/baked-layouts/:name` endpoint exists for PUT).

## Context Files
- `tasks/shared-context.md`
- `tasks/updated-prd.md`
- `packages/world/src/app/layout-bake-service.ts` — what we invoke.
- `packages/world/src/app/types.ts` — for service interface conventions.

## Files to Create
- `packages/world/src/app/bake-registry.ts`
- `packages/world/src/app/bake-registry.test.ts`

## Files to Modify
- `packages/world/src/app/index.ts` — export `BakeRegistry` (or just the public functions).

## Requirements
1. Export a singleton-style API (module-level state):
   ```
   export interface BakeResult {
     layoutName: string;
     path: string;        // e.g. `/api/baked-layouts/foo`
     blob: Uint8Array;
     version: number;     // monotonic per layout
   }
   export interface BakeDeps {
     kindLookup: KindLookup;
     gltfLoader: (url: string) => Promise<Uint8Array>;
     publish: (layoutName: string, glb: Uint8Array) => Promise<void>; // PUT to /api/baked-layouts/...
   }
   export function scheduleBake(layoutName: string, doc: LayoutDocument, deps: BakeDeps): void;
   export function getBakePromise(layoutName: string): Promise<BakeResult> | null;
   export function awaitFresh(layoutName: string, deps: BakeDeps, docFetcher: () => Promise<LayoutDocument>): Promise<BakeResult>;
   export function getVersion(layoutName: string): number; // 0 if never baked
   export function subscribe(listener: (layoutName: string, state: BakeState) => void): () => void;
   export type BakeState = 'idle' | 'pending' | 'running' | 'settled' | 'error';
   ```
2. Internal state: `Map<layoutName, { timeout?: NodeJS.Timeout; inFlight?: Promise<BakeResult>; version: number; lastError?: Error; latestDoc?: LayoutDocument }>`.
3. `scheduleBake` behavior:
   - Store `latestDoc`.
   - Clear any pending timeout.
   - Set new timeout, 1500ms.
   - On timer fire: if a bake is already `inFlight`, wait for it then re-bake with `latestDoc` (only if doc changed during in-flight); otherwise start a new bake.
   - Notify subscribers on state transitions.
4. `awaitFresh` behavior: if `inFlight` exists, return it. Else trigger a synchronous bake (no debounce wait) using `docFetcher()`, return the promise.
5. `subscribe` allows the UI to render a "bake status" pill driven by registry state.
6. Persist nothing across page reloads — version counter resets to 0. The on-disk GLB is the only durable artifact.
7. NO `three`, NO `react`. Pure JS / Promise-based.

## Acceptance Criteria
- Unit test verifies two `scheduleBake` calls within 1500ms collapse to a single bake (mock `bakeLayout` and `publish`).
- Unit test verifies `awaitFresh` returns the in-flight promise if one exists.
- Unit test verifies version increments on each successful bake.
- Unit test using fake timers shows the debounce window.
- Unit test where the React-equivalent caller "unmounts" (no references to the promise from the registry's caller) and a later consumer can still `await` the in-flight bake to completion.
- `pnpm -C packages/world test` green.
- `grep -rn "from 'three'" packages/world/src/app/bake-registry.ts` → 0 matches.
- `grep -rn "from 'react'" packages/world/src/app/bake-registry.ts` → 0 matches.

## Implementation Notes
- Use Vitest's `vi.useFakeTimers()` for debounce tests.
- Subscribers are useful for the Layout Toolbar status pill — keep the listener API simple (one shape, no event bus library).
- If a bake fails, set state to `'error'`, store `lastError`, and propagate via the promise rejection. The next `scheduleBake` should clear the error.
- `BakeDeps.publish` is injected so we can test without the network. In production it's a `fetch` PUT to `/api/baked-layouts/:name`.
- Use `globalThis.setTimeout` / `clearTimeout` (not Node-specific `NodeJS.Timeout` typing — use `ReturnType<typeof setTimeout>`).
