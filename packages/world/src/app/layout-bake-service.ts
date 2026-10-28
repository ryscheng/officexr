/**
 * Headless layout bake function. Compiles a `LayoutDocument` (placeObject
 * + extrude) exactly as the runtime does and merges every compiled
 * instance into a single optimised GLB using `@gltf-transform/core`
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
import type { InstanceGeometryService } from './types.ts';
import { worldObjectsToColliders } from '../physics/rules.ts';
import { createRoomService } from './room-service.ts';
import { compressDocument, registerCompressionCodecs } from './glb-compression.ts';
import { buildColliderExtras } from './baked-collider-extras.ts';
import { BAKE_SOURCE_VERSION, computeBakeSourceFingerprint, type SubtleProvider } from './bake-source.ts';
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
  /** Overrides where the bake-source fingerprint finds `crypto.subtle`. */
  subtle?: SubtleProvider;
}

/** Return value of `bakeLayout`. */
export interface BakeResultBytes {
  /** The merged, optimised GLB as a `Uint8Array`. */
  glb: Uint8Array;
  meta: {
    /** Number of distinct kind IDs among the compiled instances. */
    kindCount: number;
    /** Number of layout commands (placeObject + extrude) compiled. */
    commandCount: number;
    /** Number of compiled instances baked (extrudes expand to many). */
    instanceCount: number;
    /** Stable id of the optimizer that ran. Useful for telemetry / UI. */
    optimizerId: string;
    /** Number of collider cuboids embedded in the GLB's scene extras
     * (≥ instanceCount: compound-step kinds emit several per instance). */
    colliderCount: number;
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Bake every instance a `LayoutDocument` compiles to into a single
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
  // Compile the command list through the SAME room service the runtime
  // and studio use (kind-stride from `geometry.tileStep`), so extrudes
  // expand to exactly the tiles the unbaked layout draws. The runtime
  // excludes a baked layout's compiled instances and draws this GLB
  // instead, so anything not in here vanishes visually and physically.
  const compiled = createRoomService({ geometry }).compileScene(doc);
  const instances = compiled.instances;

  if (instances.length === 0) {
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

  for (const inst of instances) {
    const kind = kindLookup(inst.kindId);
    if (!kind) {
      throw new Error(
        `bakeLayout("${doc.name}"): unknown kind "${inst.kindId}" in command "${inst.sourceCommandId}".`,
      );
    }

    seenKindIds.add(inst.kindId);

    const sourceDoc = await loadSourceDoc(kind.gltfPath);

    // Merge the source document into the output document.  mergeDocuments
    // returns a property-map that maps each source Property to its freshly-
    // cloned counterpart in outDoc.  Every call to mergeDocuments produces
    // NEW copies in outDoc even if the same sourceDoc is passed again (which
    // is the correct behaviour for N instances of the same kind).
    const propMap = mergeDocuments(outDoc, sourceDoc);

    // Retrieve the source scene and look up its merged counterpart.
    const sourceScene = sourceDoc.getRoot().listScenes()[0];
    const wrapperNode = outDoc.createNode(`inst_${inst.id}`);

    // Apply the canonical voxel→world transform via the geometry service.
    // Instance positions are in VOXEL coordinates (integer voxel
    // anchors); the geometry service converts these (and the yaw about the
    // footprint centre) to the mesh-root transform that matches the runtime
    // renderer's <ObjectInstances>, so bake and runtime stay in lockstep.
    const { position, rotationY } = geometry.meshTransform(
      inst.position,
      inst.kindId,
      inst.yawDeg,
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
    compiled,
    geometry.worldAABB,
    (kindId) => kindLookup(kindId)?.colliderShape,
  );
  // Re-resolve the scene from the root rather than trusting the
  // pre-transform `outScene` reference — a future optimizer strategy
  // could legally replace the scene object.
  const bakedScene = outDoc.getRoot().listScenes()[0] ?? outScene;
  const extras = buildColliderExtras(colliders);
  const fingerprint = await computeBakeSourceFingerprint(doc, optimizer.id, kindLookup, options?.subtle);
  if (fingerprint !== null) {
    extras.officexr.bakeSource = { version: BAKE_SOURCE_VERSION, fingerprint, layoutName: doc.name };
  }
  bakedScene.setExtras(extras);

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
      commandCount: doc.commands.length,
      instanceCount: instances.length,
      optimizerId: optimizer.id,
      colliderCount: colliders.length,
    },
  };
}
