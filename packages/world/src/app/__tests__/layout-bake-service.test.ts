/**
 * Unit tests for `bakeLayout`.
 *
 * We synthesise minimal GLBs using gltf-transform itself so there is no
 * filesystem dependency and the tests remain pure / hermetic.
 */
import { describe, it, expect } from 'vitest';
import { Document, WebIO } from '@gltf-transform/core';
import { bakeLayout } from '../layout-bake-service.ts';
import type { KindLookup } from '../layout-bake-service.ts';
import { createInstanceGeometry } from '../geometry-service.ts';
import { parseEmbeddedColliders } from '../baked-collider-extras.ts';
import type { WorldObjectKind } from '../../scenes/world-object-kinds-schema.ts';
import type { LayoutDocument } from '../../scenes/layout-document.ts';

/** Build a real geometry service from the test catalog. Tests verify the
 * bake output positions match what this service produces — i.e. the
 * exact math the runtime renderer uses. */
function makeGeometry(kindMap: Map<string, WorldObjectKind>, voxelSize = 0.5) {
  return createInstanceGeometry({
    catalog: { getKind: (id: string) => kindMap.get(id) },
    voxelSize,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const io = new WebIO();

/** Build a trivial GLB (one mesh, one primitive, no textures). */
async function makeTrivialGlb(name: string): Promise<Uint8Array> {
  const doc = new Document();
  const scene = doc.createScene(name);

  const buffer = doc.createBuffer();
  const posAccessor = doc.createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([
      -0.5, 0, -0.5,
       0.5, 0, -0.5,
       0.5, 1,  0.5,
    ]))
    .setBuffer(buffer);
  const prim = doc.createPrimitive().setAttribute('POSITION', posAccessor);
  const mesh = doc.createMesh(name + '_mesh').addPrimitive(prim);
  const node = doc.createNode(name + '_node').setMesh(mesh);
  scene.addChild(node);

  return io.writeBinary(doc);
}

function makeKind(id: string, gltfPath: string, scale = 1): WorldObjectKind {
  return {
    id,
    label: id,
    gltfPath,
    swatch: '#fff',
    walkable: false,
    scale,
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
  };
}

function makeLayoutDoc(
  name: string,
  commands: LayoutDocument['commands'],
): LayoutDocument {
  return {
    schemaVersion: 1,
    name,
    commands,
    updatedAt: 0,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bakeLayout', () => {
  it('produces a valid GLB for a single-command layout', async () => {
    const wallBytes = await makeTrivialGlb('wall');
    const kindMap = new Map<string, WorldObjectKind>([
      ['wall', makeKind('wall', '/models/wall.glb')],
    ]);
    const kindLookup: KindLookup = (id) => kindMap.get(id);
    const gltfLoader = async (_url: string) => wallBytes;

    const doc = makeLayoutDoc('room1', [
      { id: 'c1', op: 'placeObject', kindId: 'wall', position: [0, 0, 0] },
    ]);

    const result = await bakeLayout(doc, kindLookup, gltfLoader, makeGeometry(new Map()), { io });

    expect(result.glb).toBeInstanceOf(Uint8Array);
    expect(result.glb.length).toBeGreaterThan(0);
    expect(result.meta.commandCount).toBe(1);
    expect(result.meta.kindCount).toBe(1);

    // Re-parse the output GLB to confirm it is valid.
    const parsed = await io.readBinary(result.glb);
    expect(parsed.getRoot().listScenes().length).toBeGreaterThan(0);
  });

  it('merges two distinct kinds (each used once)', async () => {
    const [wallBytes, floorBytes] = await Promise.all([
      makeTrivialGlb('wall'),
      makeTrivialGlb('floor'),
    ]);

    const kindMap = new Map<string, WorldObjectKind>([
      ['wall',  makeKind('wall',  '/models/wall.glb')],
      ['floor', makeKind('floor', '/models/floor.glb')],
    ]);
    const kindLookup: KindLookup = (id) => kindMap.get(id);
    const glbByUrl: Record<string, Uint8Array> = {
      '/models/wall.glb':  wallBytes,
      '/models/floor.glb': floorBytes,
    };
    const gltfLoader = async (url: string) => {
      const b = glbByUrl[url];
      if (!b) throw new Error(`unknown url: ${url}`);
      return b;
    };

    const doc = makeLayoutDoc('room2', [
      { id: 'c1', op: 'placeObject', kindId: 'wall',  position: [0, 0, 0] },
      { id: 'c2', op: 'placeObject', kindId: 'floor', position: [0, 0, 1] },
    ]);

    const result = await bakeLayout(doc, kindLookup, gltfLoader, makeGeometry(new Map()), { io });

    expect(result.meta.commandCount).toBe(2);
    expect(result.meta.kindCount).toBe(2);

    // Output must be a parseable GLB.
    const parsed = await io.readBinary(result.glb);
    expect(parsed.getRoot().listMeshes().length).toBeGreaterThan(0);
  });

  it('deduplicates source loads: each gltfPath loaded at most once', async () => {
    let loadCount = 0;
    const wallBytes = await makeTrivialGlb('wall');
    const gltfLoader = async (_url: string) => {
      loadCount++;
      return wallBytes;
    };

    const kindMap = new Map<string, WorldObjectKind>([
      ['wall', makeKind('wall', '/models/wall.glb')],
    ]);
    const kindLookup: KindLookup = (id) => kindMap.get(id);

    const doc = makeLayoutDoc('room3', [
      { id: 'c1', op: 'placeObject', kindId: 'wall', position: [0, 0, 0] },
      { id: 'c2', op: 'placeObject', kindId: 'wall', position: [1, 0, 0] },
      { id: 'c3', op: 'placeObject', kindId: 'wall', position: [2, 0, 0] },
    ]);

    const result = await bakeLayout(doc, kindLookup, gltfLoader, makeGeometry(new Map()), { io });

    // Three commands but the wall GLB should only be loaded once.
    expect(loadCount).toBe(1);
    expect(result.meta.commandCount).toBe(3);
    expect(result.meta.kindCount).toBe(1);
  });

  it('throws for an empty command list', async () => {
    const kindLookup: KindLookup = () => undefined;
    const gltfLoader = async () => new Uint8Array(0);

    const doc = makeLayoutDoc('empty', []);

    await expect(
      bakeLayout(doc, kindLookup, gltfLoader, makeGeometry(new Map()), { io }),
    ).rejects.toThrow(/no placeObject commands/);
  });

  it('throws when a kind cannot be resolved', async () => {
    const kindLookup: KindLookup = () => undefined; // always undefined
    const gltfLoader = async () => new Uint8Array(0);

    const doc = makeLayoutDoc('missing-kind', [
      { id: 'c1', op: 'placeObject', kindId: 'ghost', position: [0, 0, 0] },
    ]);

    await expect(
      bakeLayout(doc, kindLookup, gltfLoader, makeGeometry(new Map()), { io }),
    ).rejects.toThrow(/unknown kind "ghost"/);
  });

  it('throws when the gltf loader fails', async () => {
    const wallKind = makeKind('wall', '/models/wall.glb');
    const kindLookup: KindLookup = (id) => (id === 'wall' ? wallKind : undefined);
    const gltfLoader = async () => {
      throw new Error('network error');
    };

    const doc = makeLayoutDoc('bad-loader', [
      { id: 'c1', op: 'placeObject', kindId: 'wall', position: [0, 0, 0] },
    ]);

    await expect(
      bakeLayout(doc, kindLookup, gltfLoader, makeGeometry(new Map()), { io }),
    ).rejects.toThrow(/failed to load GLTF/);
  });

  it('skips extrude commands (they are not yet implemented for layouts)', async () => {
    // A layout document with a mix of placeObject and extrude.
    // The extrude should be silently ignored; the placeObject processed.
    const wallBytes = await makeTrivialGlb('wall');
    const wallKind = makeKind('wall', '/models/wall.glb');
    const kindLookup: KindLookup = (id) => (id === 'wall' ? wallKind : undefined);
    const gltfLoader = async () => wallBytes;

    const doc: LayoutDocument = {
      schemaVersion: 1,
      name: 'mixed',
      updatedAt: 0,
      commands: [
        { id: 'c1', op: 'placeObject', kindId: 'wall', position: [0, 0, 0] },
        // extrude is part of SceneCommand union but not handled by bakeLayout
        { id: 'c2', op: 'extrude', targetCommandId: 'c1', face: 'px', count: 2 },
      ],
    };

    const result = await bakeLayout(doc, kindLookup, gltfLoader, makeGeometry(new Map()), { io });
    // Only the placeObject counts.
    expect(result.meta.commandCount).toBe(1);
  });

  it('positions instances via geometry.meshOrigin (matches runtime renderer)', async () => {
    // Regression: the bake service must NOT reimplement the voxel→world
    // transform. It must call geometry.meshOrigin(position, kindId) for
    // every instance so the baked GLB places meshes exactly where
    // <ObjectInstances> would at runtime. A prior bug treated voxel
    // coordinates as world coordinates, producing visibly spaced-out
    // cubes (e.g. 2 m cubes 4 m apart on a 0.5 m voxel grid).
    //
    // The optimization pass can collapse wrapper nodes, so this test
    // verifies the contract directly via a spy on `meshOrigin`: every
    // command's (position, kindId) must reach the geometry service.
    const blockBytes = await makeTrivialGlb('cube');
    const kindMap = new Map<string, WorldObjectKind>([
      [
        'cube',
        {
          ...makeKind('cube', '/models/cube.glb'),
          dimensions: { width: 2, height: 2, depth: 2 },
          localAABB: {
            min: { x: -1, y: -1, z: -1 },
            max: { x: 1, y: 1, z: 1 },
          },
        },
      ],
    ]);
    const kindLookup: KindLookup = (id) => kindMap.get(id);
    const gltfLoader = async () => blockBytes;

    const baseGeometry = makeGeometry(kindMap, 0.5);
    const meshOriginCalls: Array<{
      position: readonly [number, number, number];
      kindId: string;
      result: readonly [number, number, number];
    }> = [];
    const geometry: typeof baseGeometry = {
      ...baseGeometry,
      meshOrigin(position, kindId) {
        const result = baseGeometry.meshOrigin(position, kindId);
        meshOriginCalls.push({ position, kindId, result });
        return result;
      },
    };

    // Two adjacent voxel cells (4 voxels apart on a 0.5 m grid = 2 m
    // world step, exactly the cube width, so the cubes should touch).
    const doc = makeLayoutDoc('adjacency', [
      { id: 'c1', op: 'placeObject', kindId: 'cube', position: [0, 0, 0] },
      { id: 'c2', op: 'placeObject', kindId: 'cube', position: [4, 0, 0] },
    ]);

    await bakeLayout(doc, kindLookup, gltfLoader, geometry, { io });

    // The bake must consult geometry.meshOrigin for every placeObject
    // command. Two cubes → two calls, one per command (cubes share a
    // kind so the gltf loader runs once via caching, but meshOrigin must
    // run per instance for correct positioning).
    expect(meshOriginCalls.length).toBe(2);
    expect(meshOriginCalls[0].position).toEqual([0, 0, 0]);
    expect(meshOriginCalls[1].position).toEqual([4, 0, 0]);
    expect(meshOriginCalls.every((c) => c.kindId === 'cube')).toBe(true);

    // The world-space step between two adjacent voxel cells must equal
    // one cube width (the test's whole point — no spacing, no gap).
    const [t0x] = meshOriginCalls[0].result;
    const [t1x] = meshOriginCalls[1].result;
    expect(t1x - t0x).toBeCloseTo(2, 6);
  });

  it('emits fewer primitives than naive count after optimization', async () => {
    // Task 05 acceptance criterion: feed N instances of the same kind and
    // assert the post-prune primitive count is strictly less than N. This
    // verifies the optimization pipeline (dedup/weld/prune/join/flatten)
    // is actually wired up, not just structurally invoked.
    const cubeBytes = await makeTrivialGlb('cube');
    const kindMap = new Map<string, WorldObjectKind>([
      ['cube', makeKind('cube', '/models/cube.glb')],
    ]);
    const kindLookup: KindLookup = (id) => kindMap.get(id);
    const gltfLoader = async () => cubeBytes;

    const N = 8;
    const commands = Array.from({ length: N }, (_, i) => ({
      id: `c${i}`,
      op: 'placeObject' as const,
      kindId: 'cube',
      position: [i * 4, 0, 0] as [number, number, number],
    }));
    const doc = makeLayoutDoc('many-cubes', commands);

    const result = await bakeLayout(
      doc,
      kindLookup,
      gltfLoader,
      makeGeometry(kindMap),
      { io },
    );

    const parsed = await io.readBinary(result.glb);
    const primitiveCount = parsed
      .getRoot()
      .listMeshes()
      .reduce((sum, mesh) => sum + mesh.listPrimitives().length, 0);
    // N input primitives should collapse to substantially fewer after
    // dedup + join + prune. Strict inequality is the contract; a single
    // merged primitive is the realistic outcome for identical kinds.
    expect(primitiveCount).toBeLessThan(N);
  });

  it('collapses N same-kind instances to a single mesh-bearing node (draw call)', async () => {
    // Regression for the join-before-flatten bug. The primitive-count
    // test above passed even while the bug shipped, because `dedup`
    // collapsed N identical MESHES into 1 shared mesh — while N NODES
    // each still referenced it, i.e. one DRAW CALL per placed object
    // (platform.glb shipped with 625). Draw calls are what the GPU
    // pays for, so this invariant counts mesh-bearing NODES: with the
    // default pipeline (flatten → join), N instances of one kind/one
    // material must merge into exactly one renderable node.
    const cubeBytes = await makeTrivialGlb('cube');
    const kindMap = new Map<string, WorldObjectKind>([
      ['cube', makeKind('cube', '/models/cube.glb')],
    ]);
    const kindLookup: KindLookup = (id) => kindMap.get(id);
    const gltfLoader = async () => cubeBytes;

    const N = 8;
    const commands = Array.from({ length: N }, (_, i) => ({
      id: `c${i}`,
      op: 'placeObject' as const,
      kindId: 'cube',
      position: [i * 4, 0, 0] as [number, number, number],
    }));
    const doc = makeLayoutDoc('draw-call-collapse', commands);

    const result = await bakeLayout(
      doc,
      kindLookup,
      gltfLoader,
      makeGeometry(kindMap),
      { io },
    );

    const parsed = await io.readBinary(result.glb);
    const meshNodes = parsed
      .getRoot()
      .listNodes()
      .filter((n) => n.getMesh() !== null);
    expect(meshNodes.length).toBe(1);
  });

  it('embeds collider cuboids in scene extras matching geometry.worldAABB', async () => {
    // The optimizer merges (and may lossily simplify) the VISUAL mesh,
    // so the runtime can't derive physics from mesh nodes anymore. The
    // bake must embed one collider cuboid per placeObject command in
    // the scene extras, positioned by the canonical geometry service —
    // the same answer MapColliders computes for unbaked rooms.
    const cubeBytes = await makeTrivialGlb('cube');
    const kindMap = new Map<string, WorldObjectKind>([
      [
        'cube',
        {
          ...makeKind('cube', '/models/cube.glb'),
          dimensions: { width: 2, height: 2, depth: 2 },
          localAABB: {
            min: { x: -1, y: -1, z: -1 },
            max: { x: 1, y: 1, z: 1 },
          },
        },
      ],
    ]);
    const kindLookup: KindLookup = (id) => kindMap.get(id);
    const gltfLoader = async () => cubeBytes;
    const geometry = makeGeometry(kindMap, 0.5);

    const positions: Array<[number, number, number]> = [
      [0, 0, 0],
      [4, 0, 0],
      [4, 4, 4],
    ];
    const doc = makeLayoutDoc(
      'collider-extras',
      positions.map((position, i) => ({
        id: `c${i}`,
        op: 'placeObject' as const,
        kindId: 'cube',
        position,
      })),
    );

    const result = await bakeLayout(doc, kindLookup, gltfLoader, geometry, { io });
    expect(result.meta.colliderCount).toBe(positions.length);

    // Round-trip through the same parser the renderer uses.
    const parsed = await io.readBinary(result.glb);
    const extras = parsed.getRoot().listScenes()[0].getExtras();
    const cuboids = parseEmbeddedColliders(extras)?.filter(
      (d): d is Extract<typeof d, { type: 'cuboid' }> => d.type === 'cuboid',
    );
    expect(cuboids).not.toBeNull();
    expect(cuboids!.length).toBe(positions.length);

    for (let i = 0; i < positions.length; i++) {
      const aabb = geometry.worldAABB(positions[i], 'cube');
      const c = cuboids![i];
      expect(c.center.x).toBeCloseTo((aabb.min[0] + aabb.max[0]) / 2, 6);
      expect(c.center.y).toBeCloseTo((aabb.min[1] + aabb.max[1]) / 2, 6);
      expect(c.center.z).toBeCloseTo((aabb.min[2] + aabb.max[2]) / 2, 6);
      expect(c.halfExtents.x).toBeCloseTo((aabb.max[0] - aabb.min[0]) / 2, 6);
      expect(c.halfExtents.y).toBeCloseTo((aabb.max[1] - aabb.min[1]) / 2, 6);
      expect(c.halfExtents.z).toBeCloseTo((aabb.max[2] - aabb.min[2]) / 2, 6);
    }
  });

  it('embeds per-step cuboids for compound-steps kinds (climbable stairs)', async () => {
    // A staircase kind must NOT bake down to one bounding-box collider —
    // that's the difference between a climbable staircase and a wall.
    // The bake threads the kind's `colliderShape` into
    // `worldObjectsToCuboids`, which emits one column per step; assert
    // the step topology (count + ascending tops) independently.
    const stairsBytes = await makeTrivialGlb('stairs');
    const stepCount = 4;
    const stepRise = 0.5;
    const kindMap = new Map<string, WorldObjectKind>([
      [
        'stairs',
        {
          ...makeKind('stairs', '/models/stairs.glb'),
          dimensions: { width: 2, height: 2, depth: 2 },
          localAABB: {
            min: { x: -1, y: -1, z: -1 },
            max: { x: 1, y: 1, z: 1 },
          },
          colliderShape: {
            kind: 'compound-steps',
            stepCount,
            stepRise,
            stepRun: 0.5,
            stepDepth: 2,
          },
        },
      ],
    ]);
    const kindLookup: KindLookup = (id) => kindMap.get(id);
    const gltfLoader = async () => stairsBytes;
    const geometry = makeGeometry(kindMap, 0.5);

    const position: [number, number, number] = [0, 0, 0];
    const doc = makeLayoutDoc('stairs-extras', [
      { id: 'c1', op: 'placeObject', kindId: 'stairs', position },
    ]);

    const result = await bakeLayout(doc, kindLookup, gltfLoader, geometry, { io });
    expect(result.meta.colliderCount).toBe(stepCount);

    const parsed = await io.readBinary(result.glb);
    const cuboids = parseEmbeddedColliders(
      parsed.getRoot().listScenes()[0].getExtras(),
    )?.filter((d): d is Extract<typeof d, { type: 'cuboid' }> => d.type === 'cuboid');
    expect(cuboids).not.toBeNull();
    expect(cuboids!.length).toBe(stepCount);

    // Step columns all share the staircase's base; their tops ascend by
    // stepRise per step. (Step i top = base + (i+1) * stepRise.)
    const aabb = geometry.worldAABB(position, 'stairs');
    const base = aabb.min[1];
    for (let i = 0; i < stepCount; i++) {
      const c = cuboids![i];
      const top = c.center.y + c.halfExtents.y;
      const bottom = c.center.y - c.halfExtents.y;
      expect(bottom).toBeCloseTo(base, 6);
      expect(top).toBeCloseTo(base + (i + 1) * stepRise, 6);
    }
  });
});
