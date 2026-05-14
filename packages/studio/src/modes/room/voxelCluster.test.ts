import { describe, it, expect } from 'vitest';
import { clusterTouchingVoxels, type Vec3 } from './voxelCluster.ts';

function sortCluster(c: readonly Vec3[]): Vec3[] {
  return [...c]
    .map((v) => [v[0], v[1], v[2]] as Vec3)
    .sort((a, b) =>
      a[0] !== b[0]
        ? a[0] - b[0]
        : a[1] !== b[1]
          ? a[1] - b[1]
          : a[2] - b[2],
    );
}

function sortClusters(cs: readonly (readonly Vec3[])[]): Vec3[][] {
  return cs
    .map(sortCluster)
    .sort((a, b) =>
      a.length !== b.length
        ? a.length - b.length
        : a[0][0] !== b[0][0]
          ? a[0][0] - b[0][0]
          : a[0][1] !== b[0][1]
            ? a[0][1] - b[0][1]
            : a[0][2] - b[0][2],
    );
}

describe('clusterTouchingVoxels', () => {
  it('returns an empty array for no input', () => {
    expect(clusterTouchingVoxels([])).toEqual([]);
  });

  it('groups a single voxel into its own cluster', () => {
    expect(clusterTouchingVoxels([[3, 0, 7]])).toEqual([[[3, 0, 7]]]);
  });

  it('merges face-adjacent voxels along +x into one cluster', () => {
    const c = clusterTouchingVoxels([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    expect(c).toHaveLength(1);
    expect(sortCluster(c[0])).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
  });

  it('treats diagonal voxels as SEPARATE (face-adjacency only)', () => {
    // (0,0,0) and (1,1,0) touch only at an edge — not a face.
    const c = clusterTouchingVoxels([
      [0, 0, 0],
      [1, 1, 0],
    ]);
    expect(c).toHaveLength(2);
  });

  it('splits a 2-column line into two clusters when middle is missing', () => {
    // The 2×4 example from the user spec — A and H selected (the two
    // diagonally opposite corners of a 2×4 grid):
    //   A B
    //   C D
    //   E F
    //   G H
    //
    // With A = (0,0,0) and H = (1,0,3) — not face-adjacent.
    const c = clusterTouchingVoxels([
      [0, 0, 0],
      [1, 0, 3],
    ]);
    expect(c).toHaveLength(2);
  });

  it('joins a full 2×4 box into a single cluster', () => {
    const positions: Vec3[] = [];
    for (let x = 0; x < 2; x++)
      for (let z = 0; z < 4; z++) positions.push([x, 0, z]);
    const c = clusterTouchingVoxels(positions);
    expect(c).toHaveLength(1);
    expect(c[0]).toHaveLength(8);
  });

  it('produces three clusters when three disjoint groups are mixed', () => {
    // Group A: a 1×2 line along x at z=0.
    // Group B: a single voxel far away.
    // Group C: a 1×2 line along z at x=10.
    const positions: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [5, 0, 5],
      [10, 0, 10],
      [10, 0, 11],
    ];
    const c = clusterTouchingVoxels(positions);
    expect(c).toHaveLength(3);
    const sizes = c.map((g) => g.length).sort();
    expect(sizes).toEqual([1, 2, 2]);
  });

  it('dedupes equal voxel positions on input', () => {
    const c = clusterTouchingVoxels([
      [0, 0, 0],
      [0, 0, 0],
      [1, 0, 0],
    ]);
    expect(c).toHaveLength(1);
    expect(c[0]).toHaveLength(2);
  });

  it('handles a 3D plus-sign with the centre + 6 face neighbours', () => {
    const positions: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    const c = clusterTouchingVoxels(positions);
    expect(c).toHaveLength(1);
    expect(c[0]).toHaveLength(7);
  });

  it('sortClusters helper produces a stable order for assertions', () => {
    const cs = clusterTouchingVoxels([
      [0, 0, 0],
      [10, 10, 10],
    ]);
    expect(sortClusters(cs)).toEqual([[[0, 0, 0]], [[10, 10, 10]]]);
  });
});
