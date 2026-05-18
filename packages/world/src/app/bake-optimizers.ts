/**
 * Bake optimizers — pluggable post-process strategies applied to the merged
 * GLB after the bake service places every instance.
 *
 * CONTRACT
 * --------
 * A `BakeOptimizer` is a function-on-a-document: it receives the merged
 * gltf-transform `Document` and mutates it (in place) to reduce size,
 * polygon count, or both. Concrete strategies compose `@gltf-transform/functions`
 * transforms like `dedup`, `weld`, `prune`, `join`, `flatten`, and
 * `simplify`.
 *
 * The interface is intentionally narrow:
 *   - input: a `Document` (the bake service builds and hands it off).
 *   - output: the same `Document`, mutated.
 * That mirrors how `@gltf-transform/functions` transforms compose — a
 * `BakeOptimizer` is really just "a named bundle of transforms with a
 * label fit for a UI dropdown".
 *
 * Strategies are registered in `BAKE_OPTIMIZERS` keyed by a stable string
 * id; the id is what gets persisted on `LayoutDocument.optimizer` and what
 * the Layout editor's dropdown writes back.
 *
 * NO `three`, NO `react`, NO DOM imports. The optimizer interface lives in
 * the headless application layer alongside the bake service it serves.
 */

import type { Document } from '@gltf-transform/core';
import {
  dedup,
  flatten,
  join,
  prune,
  simplify,
  weld,
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A named bake optimization strategy. `apply` mutates the document in
 * place; concrete implementations call `doc.transform(...)` with the
 * gltf-transform transforms that define the strategy.
 *
 * To add a new strategy:
 *   1. Implement a `BakeOptimizer`.
 *   2. Register it in `BAKE_OPTIMIZERS` keyed by a stable id.
 *   3. The Layout editor's dropdown picks it up automatically.
 */
export interface BakeOptimizer {
  /** Stable identifier persisted in `LayoutDocument.optimizer`. */
  readonly id: string;
  /** Human-readable name shown in the Layout editor dropdown. */
  readonly label: string;
  /** Optional one-line description shown beside the dropdown. */
  readonly description?: string;
  /** Apply the strategy to `doc`, mutating it in place. */
  apply(doc: Document): Promise<void>;
}

// ---------------------------------------------------------------------------
// Built-in strategies
// ---------------------------------------------------------------------------

/**
 * Minimal cleanup: run only `dedup + prune` — the buffer-level passes
 * needed to produce a writable single-buffer GLB (the spec caps at one
 * buffer per file). Skips all geometry-altering passes (`weld`, `join`,
 * `flatten`). Use when each command produces a unique mesh that would
 * be hurt by lossy passes, or for debugging the raw merged output.
 */
export const noneOptimizer: BakeOptimizer = {
  id: 'none',
  label: 'Minimal',
  description:
    'Buffer-level dedup + prune only. No mesh merging, no polygon reduction.',
  async apply(doc) {
    await doc.transform(dedup(), prune());
  },
};

/**
 * Default lossless pipeline: `dedup → weld → prune → join → flatten`.
 * Identical-vertex welding and instance merging cut size dramatically
 * when many instances share a kind, without altering polygon count
 * or appearance.
 */
export const defaultOptimizer: BakeOptimizer = {
  id: 'default',
  label: 'Default (lossless)',
  description:
    'Dedup + weld + prune + join + flatten. No polygon reduction; safe for any layout.',
  async apply(doc) {
    await doc.transform(dedup(), weld(), prune(), join(), flatten());
  },
};

/**
 * Build a lossy `simplify` strategy that runs the lossless default
 * pipeline AND a meshopt-based polygon-reduction pass.
 *
 * Per `@gltf-transform/functions` docs: a `weld` pass MUST come before
 * `simplify` (already covered by the default pipeline). `ratio` is the
 * fraction of vertices to keep (0..1); `error` is the max per-vertex
 * displacement as a fraction of mesh radius.
 */
function simplifyOptimizer(spec: {
  id: string;
  label: string;
  description: string;
  ratio: number;
  error: number;
}): BakeOptimizer {
  return {
    id: spec.id,
    label: spec.label,
    description: spec.description,
    async apply(doc) {
      await doc.transform(
        dedup(),
        weld(),
        prune(),
        join(),
        flatten(),
        simplify({
          simplifier: MeshoptSimplifier,
          ratio: spec.ratio,
          error: spec.error,
        }),
      );
    },
  };
}

/**
 * Conservative polygon reduction: aim for 75% of original vertices,
 * tightly constrained on error. Visually indistinguishable from default
 * for typical block-grid layouts; small but real triangle savings.
 */
export const simplifyLightOptimizer: BakeOptimizer = simplifyOptimizer({
  id: 'simplify-light',
  label: 'Simplify (light)',
  description:
    'Default pipeline + meshopt simplify aiming for ~75% vertex retention, max 0.01% error.',
  ratio: 0.75,
  error: 0.0001,
});

/**
 * Aggressive polygon reduction: aim for 25% of original vertices, with
 * a wider error budget. Best for large layouts where polygon count
 * dominates load time and minor surface drift is acceptable.
 */
export const simplifyAggressiveOptimizer: BakeOptimizer = simplifyOptimizer({
  id: 'simplify-aggressive',
  label: 'Simplify (aggressive)',
  description:
    'Default pipeline + meshopt simplify aiming for ~25% vertex retention, max 0.5% error.',
  ratio: 0.25,
  error: 0.005,
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Stable id → `BakeOptimizer`. Iteration order is the order of insertion,
 * which is also the order the Layout editor dropdown displays.
 */
export const BAKE_OPTIMIZERS: ReadonlyMap<string, BakeOptimizer> = new Map([
  [defaultOptimizer.id, defaultOptimizer],
  [simplifyLightOptimizer.id, simplifyLightOptimizer],
  [simplifyAggressiveOptimizer.id, simplifyAggressiveOptimizer],
  [noneOptimizer.id, noneOptimizer],
]);

/** Default fallback when a layout's stored optimizer id is unknown. */
export const DEFAULT_OPTIMIZER_ID = defaultOptimizer.id;

/**
 * Look up an optimizer by id. Unknown or undefined ids fall back to the
 * default optimizer so an outdated layout file (or one authored by a
 * future studio version that removed a strategy) still bakes safely.
 */
export function resolveOptimizer(id: string | undefined): BakeOptimizer {
  if (!id) return defaultOptimizer;
  return BAKE_OPTIMIZERS.get(id) ?? defaultOptimizer;
}
