import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as THREE from 'three';
import { useShooting } from '@/hooks/useShooting';

// ---------------------------------------------------------------------------
// Helpers to build minimal fakes for camera, scene, and avatars
// ---------------------------------------------------------------------------

const savedPerspectiveCameraImpl = (THREE.PerspectiveCamera as unknown as vi.Mock).getMockImplementation()!;
const savedSceneImpl = (THREE.Scene as unknown as vi.Mock).getMockImplementation()!;
const savedMeshImpl = (THREE.Mesh as unknown as vi.Mock).getMockImplementation()!;

function createCamera(worldDir = { x: 0, y: 0, z: -1 }) {
  const cam = savedPerspectiveCameraImpl() as any;
  // Provide getWorldDirection — not in the global mock
  cam.getWorldDirection = vi.fn((v: any) => {
    v.x = worldDir.x;
    v.y = worldDir.y;
    v.z = worldDir.z;
    return v;
  });
  return cam;
}

function createScene() {
  const s = savedSceneImpl() as any;
  // scene.traverse calls the cb with every child; default mock passes nothing
  s.traverse = vi.fn();
  return s;
}

function createAvatars(): Map<string, THREE.Group> {
  return new Map();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useShooting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── third-person-front: direction and origin ─────────────────────────────

  describe('third-person-front mode', () => {
    it('fires along avatar facing direction (playerYaw=0 → direction (0,0,-1))', () => {
      const { result } = renderHook(() => useShooting());
      const camera = createCamera({ x: 0, y: 0, z: 1 }); // camera faces backward
      const scene = createScene();
      const avatars = createAvatars();

      const playerPosition = { x: 2, y: 0, z: 3 } as THREE.Vector3;
      const playerYaw = 0;

      result.current.fireBullet(
        camera, scene, avatars,
        'third-person-front',
        playerYaw,
        playerPosition,
      );

      // Bullet mesh was created and added to scene
      expect(scene.add).toHaveBeenCalled();

      // The bullet direction should be (-sin(0), 0, -cos(0)) = (0, 0, -1)
      // We verify this via the bullet's starting position: origin + 0.5 * dir
      // origin = (2, 1.4, 3), dir = (0, 0, -1)
      // expected start = (2, 1.4, 3 - 0.5) = (2, 1.4, 2.5)
      const addedMesh = (scene.add as vi.Mock).mock.calls[0][0] as any;
      // The mesh's position.copy(origin).addScaledVector(dir, 0.5) was called
      // In the mock, copy sets x/y/z from origin then addScaledVector adds dir*0.5
      expect(addedMesh.position.x).toBeCloseTo(2, 5);
      expect(addedMesh.position.y).toBeCloseTo(1.4, 5);
      expect(addedMesh.position.z).toBeCloseTo(2.5, 5); // 3 + (-1)*0.5
    });

    it('fires along avatar facing for non-zero yaw (yaw=PI/2 → direction (-1,0,0))', () => {
      const { result } = renderHook(() => useShooting());
      const camera = createCamera({ x: 1, y: 0, z: 0 }); // camera faces backward (wrong dir)
      const scene = createScene();
      const avatars = createAvatars();

      const playerPosition = { x: 0, y: 0, z: 0 } as THREE.Vector3;
      const playerYaw = Math.PI / 2; // 90 degrees

      result.current.fireBullet(
        camera, scene, avatars,
        'third-person-front',
        playerYaw,
        playerPosition,
      );

      // dir = (-sin(PI/2), 0, -cos(PI/2)) = (-1, 0, 0)
      // origin = (0, 1.4, 0)
      // bullet start = (0 + (-1)*0.5, 1.4, 0) = (-0.5, 1.4, 0)
      const addedMesh = (scene.add as vi.Mock).mock.calls[0][0] as any;
      expect(addedMesh.position.x).toBeCloseTo(-0.5, 5);
      expect(addedMesh.position.y).toBeCloseTo(1.4, 5);
      expect(addedMesh.position.z).toBeCloseTo(0, 5);
    });

    it('does NOT call camera.getWorldDirection in third-person-front', () => {
      const { result } = renderHook(() => useShooting());
      const camera = createCamera();
      const scene = createScene();
      const avatars = createAvatars();

      result.current.fireBullet(
        camera, scene, avatars,
        'third-person-front',
        0,
        { x: 0, y: 0, z: 0 } as THREE.Vector3,
      );

      expect(camera.getWorldDirection).not.toHaveBeenCalled();
    });

    it('spawns bullet at avatar torso height (y=1.4)', () => {
      const { result } = renderHook(() => useShooting());
      const camera = createCamera();
      const scene = createScene();
      const avatars = createAvatars();

      result.current.fireBullet(
        camera, scene, avatars,
        'third-person-front',
        0,
        { x: 5, y: 0, z: 8 } as THREE.Vector3,
      );

      const addedMesh = (scene.add as vi.Mock).mock.calls[0][0] as any;
      // origin.y = 1.4, dir.y = 0, so position.y = 1.4 + 0*0.5 = 1.4
      expect(addedMesh.position.y).toBeCloseTo(1.4, 5);
    });
  });

  // ── first-person mode: uses camera direction ─────────────────────────────

  describe('first-person mode', () => {
    it('calls camera.getWorldDirection to get bullet direction', () => {
      const { result } = renderHook(() => useShooting());
      const camera = createCamera({ x: 0, y: 0, z: -1 });
      const scene = createScene();
      const avatars = createAvatars();

      result.current.fireBullet(
        camera, scene, avatars,
        'first-person',
        0,
        { x: 0, y: 0, z: 0 } as THREE.Vector3,
      );

      expect(camera.getWorldDirection).toHaveBeenCalled();
    });

    it('spawns bullet at camera position', () => {
      const { result } = renderHook(() => useShooting());
      const camera = createCamera({ x: 0, y: 0, z: -1 });
      camera.position.set(1, 1.6, 2);
      const scene = createScene();
      const avatars = createAvatars();

      result.current.fireBullet(
        camera, scene, avatars,
        'first-person',
        0,
        { x: 0, y: 0, z: 0 } as THREE.Vector3,
      );

      // origin = camera.position = (1, 1.6, 2)
      // dir = (0, 0, -1), addScaledVector(dir, 0.5) → z moves by -0.5
      const addedMesh = (scene.add as vi.Mock).mock.calls[0][0] as any;
      expect(addedMesh.position.x).toBeCloseTo(1, 5);
      expect(addedMesh.position.y).toBeCloseTo(1.6, 5);
      expect(addedMesh.position.z).toBeCloseTo(1.5, 5); // 2 + (-1)*0.5
    });
  });

  // ── third-person-behind mode: uses camera direction (regression) ──────────

  describe('third-person-behind mode', () => {
    it('calls camera.getWorldDirection to get bullet direction', () => {
      const { result } = renderHook(() => useShooting());
      const camera = createCamera({ x: 0, y: -0.2, z: -1 });
      const scene = createScene();
      const avatars = createAvatars();

      result.current.fireBullet(
        camera, scene, avatars,
        'third-person-behind',
        0,
        { x: 0, y: 0, z: 0 } as THREE.Vector3,
      );

      expect(camera.getWorldDirection).toHaveBeenCalled();
    });

    it('spawns bullet at camera position (not avatar position)', () => {
      const { result } = renderHook(() => useShooting());
      const camera = createCamera({ x: 0, y: 0, z: -1 });
      camera.position.set(3, 3.5, 6.5);
      const scene = createScene();
      const avatars = createAvatars();

      result.current.fireBullet(
        camera, scene, avatars,
        'third-person-behind',
        0,
        { x: 3, y: 0, z: 3 } as THREE.Vector3, // avatar at different z
      );

      // Origin is camera.position, not avatar position
      const addedMesh = (scene.add as vi.Mock).mock.calls[0][0] as any;
      expect(addedMesh.position.x).toBeCloseTo(3, 5);
      expect(addedMesh.position.y).toBeCloseTo(3.5, 5);
      // z = 6.5 + (-1)*0.5 = 6.0 (camera z, not avatar z=3)
      expect(addedMesh.position.z).toBeCloseTo(6.0, 5);
    });
  });
});
