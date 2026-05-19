/**
 * Headless layout bake function. Merges all `placeObject` commands in a
 * `LayoutDocument` into a single optimised GLB using `@gltf-transform/core`
 * and `@gltf-transform/functions`.
 *
 * CONTRACT
 * --------
 * - Zero imports from `three`, `react`, or any DOM API.
 * - Pure: same inputs (identical bytes + command list) → same output.
 * - Works in both Node 20+ and browser (accepts an injected IO instance so
 *   callers can provide NodeIO or WebIO as appropriate; defaults to WebIO).
 *
 * Usage
 * -----
 * ```ts
 * const result = await bakeLayout(layoutDoc, kindLookup, async (url) => {
 *   return new Uint8Array(await fetch(url).then(r => r.arrayBuffer()));
 * });
 * fs.writeFileSync('out.glb', Buffer.from(result.glb));
 * ```
 */

import { Document, WebIO } from '@gltf-transform/core';
import type { PlatformIO } from '@gltf-transform/core';
import { mergeDocuments } from '@gltf-transform/functions';
import type { LayoutDocument } from '../scenes/layout-document.ts';
import type { WorldObjectKind } from '../scenes/world-object-kinds-schema.ts';
import type { PlaceObjectCommand } from '../scenes/commands.ts';
import type { InstanceGeometryService } from './types.ts';
import {
  defaultOptimizer,
  resolveOptimizer,
  type BakeOptimizer,
} from './bake-optimizers.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Resolve a kind by its id.  Return `undefined` if not found. */
export interface KindLookup {
  (kindId: string): WorldObjectKind | undefined;
}

/** Options for the bake pass. */
export interface BakeOptions {
  /**
   * Whether to apply Draco compression to the output GLB.
   * Default: false (off).  Enabling it adds a runtime decoder requirement.
   */
  compress?: false | 'draco';
  /**
   * Custom IO instance to use for reading/writing GLBs.
   * When omitted a `WebIO` instance is created internally.
   * Inject `NodeIO` when running under Node if you need filesystem reads
   * (the bake function itself only uses `readBinary`/`writeBinary`, so
   * WebIO is sufficient for bytes-in / bytes-out usage).
   */
  io?: PlatformIO;
  /**
   * Post-process optimization strategy applied after instances are merged.
   * Accepts either a concrete `BakeOptimizer` (for ad-hoc strategies in
   * tests) or a string id resolved via `BAKE_OPTIMIZERS` (the production
   * path, driven by `LayoutDocument.optimizer`). When omitted, falls back
   * to `defaultOptimizer` (lossless: dedup/weld/prune/join/flatten).
   */
  optimizer?: BakeOptimizer | string;
}

/** Return value of `bakeLayout`. */
export interface BakeResultBytes {
  /** The merged, optimised GLB as a `Uint8Array`. */
  glb: Uint8Array;
  meta: {
    /** Number of distinct kind IDs referenced by placeObject commands. */
    kindCount: number;
    /** Total number of placeObject commands processed. */
    commandCount: number;
    /** Stable id of the optimizer that ran. Useful for telemetry / UI. */
    optimizerId: string;
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Bake all `placeObject` commands in a `LayoutDocument` into a single
 * optimised GLB.
 *
 * @param doc         The layout document to bake.
 * @param kindLookup  Resolver for kind IDs → `WorldObjectKind`.
 * @param gltfLoader  Async loader that returns raw GLB bytes for a URL.
 * @param geometry    Canonical voxel→world transform service. The bake
 *                    uses `geometry.meshOrigin(position, kindId)` so the
 *                    baked GLB matches the runtime renderer's positioning
 *                    exactly. This is the SAME service the runtime
 *                    `<ObjectInstances>` consumes — no bespoke math here.
 * @param options     Optional bake options (IO instance, compression).
 */
export async function bakeLayout(
  doc: LayoutDocument,
  kindLookup: KindLookup,
  gltfLoader: (url: string) => Promise<Uint8Array>,
  geometry: InstanceGeometryService,
  options?: BakeOptions,
): Promise<BakeResultBytes> {
  // Collect placeObject commands only — extrude is not used in layouts yet.
  const placeCommands = doc.commands.filter(
    (c): c is PlaceObjectCommand => c.op === 'placeObject',
  );

  if (placeCommands.length === 0) {
    throw new Error(
      `bakeLayout("${doc.name}"): document contains no placeObject commands.`,
    );
  }

  const io: PlatformIO = options?.io ?? new WebIO();

  // Cache loaded source documents by gltfPath to avoid redundant network/fs
  // fetches and re-parses when the same kind appears multiple times.
  const sourceDocCache = new Map<string, Document>();

  async function loadSourceDoc(url: string): Promise<Document> {
    const cached = sourceDocCache.get(url);
    if (cached) return cached;

    let bytes: Uint8Array;
    try {
      bytes = await gltfLoader(url);
    } catch (err) {
      throw new Error(
        `bakeLayout("${doc.name}"): failed to load GLTF for "${url}": ${(err as Error).message}`,
      );
    }

    let sourceDoc: Document;
    try {
      sourceDoc = await io.readBinary(bytes);
    } catch (err) {
      throw new Error(
        `bakeLayout("${doc.name}"): failed to parse GLTF for "${url}": ${(err as Error).message}`,
      );
    }

    sourceDocCache.set(url, sourceDoc);
    return sourceDoc;
  }

  // Build the merged output document.
  const outDoc = new Document();
  const outScene = outDoc.createScene('baked');

  const seenKindIds = new Set<string>();

  for (const cmd of placeCommands) {
    const kind = kindLookup(cmd.kindId);
    if (!kind) {
      throw new Error(
        `bakeLayout("${doc.name}"): unknown kind "${cmd.kindId}" in command "${cmd.id}".`,
      );
    }

    seenKindIds.add(cmd.kindId);

    const sourceDoc = await loadSourceDoc(kind.gltfPath);

    // Merge the source document into the output document.  mergeDocuments
    // returns a property-map that maps each source Property to its freshly-
    // cloned counterpart in outDoc.  Every call to mergeDocuments produces
    // NEW copies in outDoc even if the same sourceDoc is passed again (which
    // is the correct behaviour for N instances of the same kind).
    const propMap = mergeDocuments(outDoc, sourceDoc);

    // Retrieve the source scene and look up its merged counterpart.
    const sourceScene = sourceDoc.getRoot().listScenes()[0];
    const wrapperNode = outDoc.createNode(`inst_${cmd.id}`);

    // Apply the canonical voxel→world transform via the geometry service.
    // PlaceObjectCommand.position is in VOXEL coordinates (integer voxel
    // anchors); the geometry service converts these to the mesh-root
    // translation that matches the runtime renderer's <ObjectInstances>.
    // Using the same service here keeps bake and runtime in lockstep —
    // any change to voxelSize / mesh-origin convention propagates to both
    // automatically. No bespoke math in the bake service.
    const [tx, ty, tz] = geometry.meshOrigin(cmd.position, cmd.kindId);
    wrapperNode.setTranslation([tx, ty, tz]);

    // Apply the kind's uniform scale (most kinds have scale=1).
    if (kind.scale !== 1) {
      wrapperNode.setScale([kind.scale, kind.scale, kind.scale]);
    }

    if (sourceScene) {
      // propMap.get(sourceScene) gives the merged Scene copy in outDoc.
      // Walk its children (the top-level nodes) and re-parent them under our
      // wrapper instance node.
      const mergedScene = propMap.get(sourceScene);
      if (mergedScene && 'listChildren' in mergedScene) {
        // Cast is safe: a Scene in the map maps to a Scene.
        type GltfScene = { listChildren(): Array<ReturnType<Document['createNode']>> };
        const typedScene = mergedScene as unknown as GltfScene;
        for (const mergedNode of typedScene.listChildren()) {
          wrapperNode.addChild(mergedNode);
        }
      }
    }

    outScene.addChild(wrapperNode);
  }

  // Resolve and apply the post-process optimization strategy. The bake
  // service intentionally does NOT bake a specific pipeline into its own
  // code — strategies live in `bake-optimizers.ts` so new ones can be
  // added without touching this file.
  const optimizer: BakeOptimizer =
    typeof options?.optimizer === 'string'
      ? resolveOptimizer(options.optimizer)
      : (options?.optimizer ?? defaultOptimizer);
  await optimizer.apply(outDoc);

  // GLB output requires exactly 0–1 buffers (spec constraint of the
  // binary container). After mergeDocuments runs N times — once per
  // source kind — outDoc holds one buffer per source GLB. The
  // optimizer's `dedup` collapses IDENTICAL buffers but won't merge
  // buffers whose bytes differ, and `join` / `flatten` don't relocate
  // accessor storage. So before writeBinary we consolidate every
  // remaining accessor onto a single target buffer and dispose the
  // others. This belongs in the bake service (a property of the GLB
  // output path) rather than in every optimizer.
  const buffers = outDoc.getRoot().listBuffers();
  if (buffers.length > 1) {
    const target = buffers[0];
    for (const accessor of outDoc.getRoot().listAccessors()) {
      accessor.setBuffer(target);
    }
    for (const b of buffers.slice(1)) {
      b.dispose();
    }
  }

  // Draco compression is opt-in (off by default) to avoid mandatory decoder
  // dependencies on the consuming side.  When enabled the caller is
  // responsible for registering the Draco encoder dependency on the IO
  // instance before passing it in `options.io`.
  if (options?.compress === 'draco') {
    // DIP note: draco() is imported conditionally to avoid pulling the
    // encoder WASM into every bundle.  The caller must set up the encoder
    // on the IO instance themselves; we call the transform unconditionally
    // once the compress flag is set.
    const { draco } = await import('@gltf-transform/functions');
    await outDoc.transform(draco());
  }

  const glb = await io.writeBinary(outDoc);

  return {
    glb,
    meta: {
      kindCount: seenKindIds.size,
      commandCount: placeCommands.length,
      optimizerId: optimizer.id,
    },
  };
}
