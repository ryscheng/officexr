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
}

// ─── Spawn ───────────────────────────────────────────────────────────────────

export function spawnConfetti(
  scene: THREE.Scene,
  origin: THREE.Vector3,
  key: string,
): Particle[] {
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
    // Slight random offset so they don't all start at exact same point
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

    // Gravity
    p.velocity.y -= 9.8 * delta;

    // Move
    p.sprite.position.addScaledVector(p.velocity, delta);

    // Rotate
    p.sprite.material.rotation += p.rotationSpeed * delta;

    // Fade out
    p.sprite.material.opacity = 1 - p.age / p.maxAge;

    survivors.push(p);
  }

  return survivors;
}
