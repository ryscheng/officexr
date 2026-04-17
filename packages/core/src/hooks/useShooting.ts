import { useCallback, useRef } from 'react';
import * as THREE from 'three';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BulletParticle {
  sprite: THREE.Sprite;
  age: number;
  maxAge: number;
}

interface Bullet {
  mesh: THREE.Mesh;
  direction: THREE.Vector3;
  speed: number;
  distanceTraveled: number;
  maxDistance: number;
  hitAvatarId: string | null;
  trailTimer: number;
}

export type CameraMode = 'first-person' | 'third-person-behind' | 'third-person-front';

export interface ShootingHandle {
  /**
   * Fire a bullet from the camera in the gaze direction.
   * Performs an immediate raycast to find the first hard surface (or avatar) and
   * animates the bullet to that impact point.
   *
   * In third-person-front mode, bullets are fired along the avatar's facing
   * direction from the avatar's torso rather than from the camera (which in that
   * mode is looking back at the player).
   */
  fireBullet: (
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    avatars: Map<string, THREE.Group>,
    cameraMode: CameraMode,
    playerYaw: number,
    playerPosition: THREE.Vector3,
  ) => void;
  /**
   * Per-frame update: move active bullets, spawn/age sparkle trail particles,
   * detect impacts, and clean up. Call from the main animation loop.
   * @param onAvatarHit - called with the avatar's userId when a bullet hits it
   */
  updateBullets: (
    delta: number,
    scene: THREE.Scene,
    onAvatarHit: (avatarId: string) => void,
  ) => void;
}

// ─── Sparkle texture ──────────────────────────────────────────────────────────

function buildSparkleTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // Radial gradient: bright white core → icy-blue edge → transparent
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0,    'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.20, 'rgba(230, 245, 255, 0.85)');
  grad.addColorStop(0.50, 'rgba(180, 220, 255, 0.35)');
  grad.addColorStop(1.0,  'rgba(120, 180, 255, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useShooting(): ShootingHandle {
  const bulletsRef   = useRef<Bullet[]>([]);
  const particlesRef = useRef<BulletParticle[]>([]);
  const sparkleTexRef = useRef<THREE.CanvasTexture | null>(null);

  // Lazy-initialise the shared sparkle texture
  const getSparkle = useCallback((): THREE.CanvasTexture => {
    if (!sparkleTexRef.current) sparkleTexRef.current = buildSparkleTexture();
    return sparkleTexRef.current;
  }, []);

  // ── fireBullet ─────────────────────────────────────────────────────────────

  const fireBullet = useCallback((
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    avatars: Map<string, THREE.Group>,
    cameraMode: CameraMode,
    playerYaw: number,
    playerPosition: THREE.Vector3,
  ) => {
    const dir = new THREE.Vector3();
    let origin: THREE.Vector3;

    if (cameraMode === 'third-person-front') {
      // Camera looks back at the player in this mode, so camera.getWorldDirection
      // would point into the avatar. Fire along the avatar's facing direction instead.
      dir.set(-Math.sin(playerYaw), 0, -Math.cos(playerYaw));
      origin = new THREE.Vector3(playerPosition.x, 1.4, playerPosition.z);
    } else {
      // first-person and third-person-behind: camera's world direction is correct
      camera.getWorldDirection(dir);
      origin = camera.position.clone();
    }

    // Identify all avatar meshes so they can be checked separately
    const avatarMeshSet = new Set<THREE.Object3D>();
    avatars.forEach(avatar =>
      avatar.traverse(c => { if ((c as THREE.Mesh).isMesh) avatarMeshSet.add(c); })
    );

    // Collect solid (non-transparent) environment meshes
    const envObjects: THREE.Object3D[] = [];
    scene.traverse(child => {
      if (!(child as THREE.Mesh).isMesh) return;
      if (avatarMeshSet.has(child)) return;                   // handled separately
      const mat = (child as THREE.Mesh).material;
      // Skip highly-transparent objects (glass walls, bubble spheres, etc.)
      if (!Array.isArray(mat) && mat.transparent && (mat as THREE.MeshStandardMaterial).opacity < 0.6) return;
      envObjects.push(child);
    });

    // Raycast: start just in front of origin, max range 100 units
    const rc = new THREE.Raycaster(origin.clone(), dir.clone(), 0.5, 100);

    const envHits = rc.intersectObjects(envObjects, false);
    let maxDist = 50;
    let hitAvatarId: string | null = null;

    if (envHits.length > 0) maxDist = envHits[0].distance;

    // Check each remote avatar independently
    avatars.forEach((avatar, uid) => {
      const meshes: THREE.Object3D[] = [];
      avatar.traverse(c => { if ((c as THREE.Mesh).isMesh) meshes.push(c); });
      const hits = rc.intersectObjects(meshes, false);
      if (hits.length > 0 && hits[0].distance < maxDist) {
        maxDist = hits[0].distance;
        hitAvatarId = uid;
      }
    });

    // Create the bullet mesh: small bright white sphere
    const bulletMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    // Position at the raycaster near plane (0.5 units ahead)
    bulletMesh.position.copy(origin).addScaledVector(dir, 0.5);
    scene.add(bulletMesh);

    bulletsRef.current.push({
      mesh: bulletMesh,
      direction: dir.clone(),
      speed: 25,
      distanceTraveled: 0,
      // Subtract the 0.5 offset so the bullet stops at the true hit point
      maxDistance: Math.max(0.2, maxDist - 0.5),
      hitAvatarId,
      trailTimer: 0,
    });
  }, []);

  // ── updateBullets ──────────────────────────────────────────────────────────

  const updateBullets = useCallback((
    delta: number,
    scene: THREE.Scene,
    onAvatarHit: (avatarId: string) => void,
  ) => {
    const sparkle = getSparkle();

    // Helper: add one sparkle sprite near `pos`
    const addParticle = (pos: THREE.Vector3, scale: number, maxAge: number) => {
      const mat = new THREE.SpriteMaterial({
        map: sparkle,
        transparent: true,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(scale, scale, scale);
      sprite.position.set(
        pos.x + (Math.random() - 0.5) * 0.06,
        pos.y + (Math.random() - 0.5) * 0.06,
        pos.z + (Math.random() - 0.5) * 0.06,
      );
      scene.add(sprite);
      particlesRef.current.push({ sprite, age: 0, maxAge });
    };

    // ── Advance each bullet ──────────────────────────────────────────────────
    const aliveBullets: Bullet[] = [];

    for (const b of bulletsRef.current) {
      const step = b.speed * delta;
      b.distanceTraveled += step;
      b.mesh.position.addScaledVector(b.direction, step);

      // Spawn trail sparkles every ~12 ms
      b.trailTimer += delta;
      if (b.trailTimer > 0.012) {
        b.trailTimer = 0;
        for (let i = 0; i < 3; i++) {
          addParticle(
            b.mesh.position,
            0.05 + Math.random() * 0.06,
            0.08 + Math.random() * 0.09,
          );
        }
      }

      if (b.distanceTraveled >= b.maxDistance) {
        // Impact: burst of sparkles radiating outward
        for (let i = 0; i < 20; i++) {
          const spread = new THREE.Vector3(
            (Math.random() - 0.5),
            (Math.random() - 0.5),
            (Math.random() - 0.5),
          ).normalize().multiplyScalar(Math.random() * 0.25);
          addParticle(
            b.mesh.position.clone().add(spread),
            0.08 + Math.random() * 0.14,
            0.22 + Math.random() * 0.22,
          );
        }

        if (b.hitAvatarId) onAvatarHit(b.hitAvatarId);

        // Remove bullet mesh
        scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        (b.mesh.material as THREE.Material).dispose();
      } else {
        aliveBullets.push(b);
      }
    }
    bulletsRef.current = aliveBullets;

    // ── Age out sparkle particles ────────────────────────────────────────────
    const aliveParticles: BulletParticle[] = [];
    for (const p of particlesRef.current) {
      p.age += delta;
      if (p.age >= p.maxAge) {
        scene.remove(p.sprite);
        p.sprite.material.dispose();
      } else {
        // Quadratic fade-out for a soft trail feel
        const t = p.age / p.maxAge;
        p.sprite.material.opacity = (1 - t) * (1 - t);
        aliveParticles.push(p);
      }
    }
    particlesRef.current = aliveParticles;
  }, [getSparkle]);

  return { fireBullet, updateBullets };
}
