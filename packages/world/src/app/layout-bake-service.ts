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
import { worldObjectsToColliders } from '../physics/rules.ts';
import { compressDocument, registerCompressionCodecs } from './glb-compression.ts';
import { buildColliderExtras } from './baked-collider-extras.ts';
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
   * Custom IO instance to use for reading/writing GLBs.
   * When omitted a `WebIO` instance is created internally.
   * Inject `NodeIO` when running under Node if you need filesystem reads
   * (the bake function itself only uses `readBinary`/`writeBinary`, so
   * WebIO is sufficient for bytes-in / bytes-out usage).
   * `bakeLayout` registers the compression codecs on it.
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
    /** Number of collider cuboids embedded in the GLB's scene extras
     * (≥ commandCount: compound-step kinds emit several per command). */
    colliderCount: number;
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
 *                    uses `geometry.meshTransform(position, kindId, yawDeg)` so the
 *                    baked GLB matches the runtime renderer's positioning
 *                    exactly. This is the SAME service the runtime
 *                    `<ObjectInstances>` consumes — no bespoke math here.
 * @param options     Optional bake options (IO instance, optimizer).
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
    // anchors); the geometry service converts these (and the yaw about the
    // footprint centre) to the mesh-root transform that matches the runtime
    // renderer's <ObjectInstances>, so bake and runtime stay in lockstep.
    const { position, rotationY } = geometry.meshTransform(
      cmd.position,
      cmd.kindId,
      cmd.yawDeg,
    );
    wrapperNode.setTranslation([...position]);
    wrapperNode.setRotation([0, Math.sin(rotationY / 2), 0, Math.cos(rotationY / 2)]);

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

  // Embed physics colliders in the (post-optimizer) scene extras.
  //
  // The optimizer is free to merge (`join`) and lossily `simplify` the
  // VISUAL geometry, so mesh nodes can no longer serve as the collider
  // source — a fully-merged room would read back as one giant AABB.
  // Instead, compute collider descriptors from the canonical physics
  // helper `worldObjectsToColliders` — the exact function MapColliders
  // (browser, unbaked rooms) and BotPhysicsWorld.syncCubes (bots) use,
  // including compound-steps stairs, scanned cuboids and slope
  // trimeshes — so a character walks on identical geometry in baked
  // and unbaked rooms alike. `BakedLayoutColliders` reads these back
  // via `parseEmbeddedColliders`.
  //
  // Runs AFTER the optimizer so no transform can strip or reshape the
  // extras; `prune` only removes unused properties and the scene is
  // the document root's entry point, but ordering removes the question.
  const colliders = worldObjectsToColliders(
    {
      cubeSize: geometry.voxelSize,
      instances: placeCommands.map((c) => ({
        id: c.id,
        sourceCommandId: c.id,
        kindId: c.kindId,
        position: c.position,
        yawDeg: c.yawDeg,
      })),
    },
    geometry.worldAABB,
    (kindId) => kindLookup(kindId)?.colliderShape,
  );
  // Re-resolve the scene from the root rather than trusting the
  // pre-transform `outScene` reference — a future optimizer strategy
  // could legally replace the scene object.
  const bakedScene = outDoc.getRoot().listScenes()[0] ?? outScene;
  bakedScene.setExtras(buildColliderExtras(colliders));

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

  await registerCompressionCodecs(io);
  await outDoc.transform(compressDocument);

  const glb = await io.writeBinary(outDoc);

  return {
    glb,
    meta: {
      kindCount: seenKindIds.size,
      commandCount: placeCommands.length,
      optimizerId: optimizer.id,
      colliderCount: colliders.length,
    },
  };
}
