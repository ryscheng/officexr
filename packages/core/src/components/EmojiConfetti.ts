import * as THREE from 'three';

export const EMOJI_MAP: Record<string, string> = {
  '1': '\u{1F602}', // 😂
  '2': '\u{1F4A9}', // 💩
  '3': '\u{1F4AF}', // 💯
  '4': '\u{1F525}', // 🔥
  '5': '\u{1F389}', // 🎉
};

// ─── Texture cache ───────────────────────────────────────────────────────────

const textureCache = new Map<string, THREE.CanvasTexture>();

function createEmojiTexture(emoji: string): THREE.CanvasTexture {
  const cached = textureCache.get(emoji);
  if (cached) return cached;

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.font = `${size - 8}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, size / 2, size / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  textureCache.set(emoji, texture);
  return texture;
}

// ─── Particle type ───────────────────────────────────────────────────────────

export interface Particle {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  age: number;
  maxAge: number;
  rotationSpeed: number;
  is2D?: boolean;
  initialScale?: number;
}

// ─── Spawn (3D — upward spray with gravity) ─────────────────────────────────

export function spawnConfetti(
  scene: THREE.Scene,
  origin: THREE.Vector3,
  key: string,
  is2D = false,
): Particle[] {
  if (is2D) return spawnConfetti2D(scene, origin, key);

  const emoji = EMOJI_MAP[key];
  if (!emoji) return [];

  const texture = createEmojiTexture(emoji);
  const count = 25;
  const particles: Particle[] = [];

  for (let i = 0; i < count; i++) {
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    const scale = 0.3 + Math.random() * 0.25;
    sprite.scale.set(scale, scale, scale);
    sprite.position.copy(origin);
    sprite.position.x += (Math.random() - 0.5) * 0.5;
    sprite.position.z += (Math.random() - 0.5) * 0.5;
    scene.add(sprite);

    particles.push({
      sprite,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        3 + Math.random() * 4,
        (Math.random() - 0.5) * 5,
      ),
      age: 0,
      maxAge: 1.5 + Math.random() * 1,
      rotationSpeed: (Math.random() - 0.5) * 6,
    });
  }

  return particles;
}

// ─── Spawn (2D — radial outward spread, visible from top-down) ──────────────

function spawnConfetti2D(
  scene: THREE.Scene,
  origin: THREE.Vector3,
  key: string,
): Particle[] {
  const emoji = EMOJI_MAP[key];
  if (!emoji) return [];

  const texture = createEmojiTexture(emoji);
  const count = 20;
  const particles: Particle[] = [];

  for (let i = 0; i < count; i++) {
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    const initScale = 0.15 + Math.random() * 0.1;
    sprite.scale.set(initScale, initScale, initScale);
    // Position at fixed height visible from top-down camera
    sprite.position.set(origin.x, 1.0, origin.z);
    sprite.position.x += (Math.random() - 0.5) * 0.3;
    sprite.position.z += (Math.random() - 0.5) * 0.3;
    scene.add(sprite);

    // Radial outward velocity on XZ plane, no Y component
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 2;
    particles.push({
      sprite,
      velocity: new THREE.Vector3(
        Math.cos(angle) * speed,
        0,
        Math.sin(angle) * speed,
      ),
      age: 0,
      maxAge: 2.0 + Math.random() * 1.0,
      rotationSpeed: (Math.random() - 0.5) * 4,
      is2D: true,
      initialScale: initScale,
    });
  }

  return particles;
}

// ─── Update ──────────────────────────────────────────────────────────────────

export function updateParticles(
  particles: Particle[],
  delta: number,
  scene: THREE.Scene,
): Particle[] {
  const survivors: Particle[] = [];

  for (const p of particles) {
    p.age += delta;
    if (p.age >= p.maxAge) {
      scene.remove(p.sprite);
      p.sprite.material.dispose();
      continue;
    }

    if (p.is2D) {
      // 2D mode: radial spread, scale up then fade out
      const t = p.age / p.maxAge;
      const baseScale = p.initialScale ?? 0.2;
      const growScale = baseScale + (0.6 - baseScale) * Math.min(t * 3, 1);
      p.sprite.scale.set(growScale, growScale, growScale);
      // Slow down over time
      p.velocity.multiplyScalar(1 - delta * 1.5);
      p.sprite.position.addScaledVector(p.velocity, delta);
      p.sprite.material.rotation += p.rotationSpeed * delta;
      p.sprite.material.opacity = 1 - t;
    } else {
      // 3D mode: gravity + vertical spray
      p.velocity.y -= 9.8 * delta;
      p.sprite.position.addScaledVector(p.velocity, delta);
      p.sprite.material.rotation += p.rotationSpeed * delta;
      p.sprite.material.opacity = 1 - p.age / p.maxAge;
    }

    survivors.push(p);
  }

  return survivors;
}
