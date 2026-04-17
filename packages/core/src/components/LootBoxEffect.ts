import * as THREE from 'three';
import { LOOT_ITEMS, LootItem, RARITY_CONFIG, Rarity } from '@/data/lootBoxItems';

// ─── 3D overhead loot box opening effect ────────────────────────────────────
// Visible to all players: items cycle above the opener's head like COD Zombies
// mystery box. Items pop in and out, cycling faster then slower until landing
// on the final item with a rarity-colored glow burst.

export interface LootBoxEffect3D {
  /** The group attached to the scene. Remove it when done. */
  group: THREE.Group;
  /** Call every frame with delta. Returns false when the effect is done. */
  update: (delta: number) => boolean;
}

// ─── Emoji → texture cache (shared with EmojiConfetti pattern) ──────────────

const emojiTexCache = new Map<string, THREE.CanvasTexture>();

function getEmojiTexture(emoji: string): THREE.CanvasTexture {
  const cached = emojiTexCache.get(emoji);
  if (cached) return cached;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.font = `${size - 16}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, size / 2, size / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  emojiTexCache.set(emoji, tex);
  return tex;
}

// ─── Rarity glow texture ────────────────────────────────────────────────────

function buildGlowTexture(color: string): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(0.4, color.replace(')', ',0.5)').replace('rgb', 'rgba'));
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// ─── Text label sprite ──────────────────────────────────────────────────────

function createTextSprite(text: string, color: string, fontSize = 48): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Shadow
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2, 0.5, 1);
  return sprite;
}

// ─── Spawn the overhead effect ──────────────────────────────────────────────

export function spawnLootBoxEffect(
  scene: THREE.Scene,
  position: THREE.Vector3,
  finalItem: LootItem,
): LootBoxEffect3D {
  const group = new THREE.Group();
  group.position.copy(position);
  group.position.y = 2.4; // above head
  scene.add(group);

  // Build a sequence of random items to cycle through, ending with the final item
  const cycleCount = 18;
  const cycleItems: LootItem[] = [];
  for (let i = 0; i < cycleCount - 1; i++) {
    cycleItems.push(LOOT_ITEMS[Math.floor(Math.random() * LOOT_ITEMS.length)]);
  }
  cycleItems.push(finalItem);

  // Current displayed sprite
  let currentSprite: THREE.Sprite | null = null;
  let currentIndex = 0;
  let elapsed = 0;
  let phase: 'cycling' | 'reveal' | 'fade' = 'cycling';
  let revealTime = 0;
  let fadeTime = 0;

  // Glow ring for the final reveal
  let glowSprite: THREE.Sprite | null = null;
  let nameSprite: THREE.Sprite | null = null;
  let raritySprite: THREE.Sprite | null = null;

  // Burst particles for the final reveal
  const burstParticles: Array<{
    sprite: THREE.Sprite;
    velocity: THREE.Vector3;
    age: number;
  }> = [];

  function setItem(item: LootItem) {
    // Remove old sprite
    if (currentSprite) {
      group.remove(currentSprite);
      currentSprite.material.dispose();
    }

    const tex = getEmojiTexture(item.emoji);
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.8, 0.8, 0.8);
    group.add(sprite);
    currentSprite = sprite;
  }

  // Start with first item
  setItem(cycleItems[0]);

  // Timing: each item shows for progressively longer
  // Item 0: 0.12s, Item 1: 0.13s, ... Item N-1: much longer
  function getItemDuration(index: number): number {
    const base = 0.1;
    const growth = 0.02;
    // Exponential slow-down near the end
    const progress = index / (cycleCount - 1);
    const slowdown = 1 + Math.pow(progress, 3) * 6;
    return (base + growth * index) * slowdown;
  }

  let itemTimer = 0;
  const totalCycleDuration = Array.from({ length: cycleCount }, (_, i) => getItemDuration(i))
    .reduce((a, b) => a + b, 0);

  const update = (delta: number): boolean => {
    elapsed += delta;

    if (phase === 'cycling') {
      itemTimer += delta;
      const dur = getItemDuration(currentIndex);
      if (itemTimer >= dur && currentIndex < cycleCount - 1) {
        itemTimer = 0;
        currentIndex++;
        setItem(cycleItems[currentIndex]);

        // Pop-in scale animation
        if (currentSprite) {
          currentSprite.scale.set(0.3, 0.3, 0.3);
        }
      }

      // Animate pop scale
      if (currentSprite) {
        const s = currentSprite.scale.x;
        if (s < 0.8) {
          const newS = Math.min(0.8, s + delta * 6);
          currentSprite.scale.set(newS, newS, newS);
        }
      }

      // Bobbing effect
      if (currentSprite) {
        currentSprite.position.y = Math.sin(elapsed * 4) * 0.1;
      }

      // Transition to reveal when we've shown the last item
      if (currentIndex === cycleCount - 1 && itemTimer > 0.3) {
        phase = 'reveal';
        revealTime = 0;

        // Add glow
        const config = RARITY_CONFIG[finalItem.rarity];
        const glowTex = buildGlowTexture(config.color);
        const glowMat = new THREE.SpriteMaterial({
          map: glowTex,
          transparent: true,
          depthTest: false,
          blending: THREE.AdditiveBlending,
          opacity: 0,
        });
        glowSprite = new THREE.Sprite(glowMat);
        glowSprite.scale.set(2.5, 2.5, 2.5);
        group.add(glowSprite);

        // Add name label
        nameSprite = createTextSprite(finalItem.name, config.color, 42);
        nameSprite.position.y = -0.7;
        nameSprite.material.opacity = 0;
        group.add(nameSprite);

        // Add rarity label
        raritySprite = createTextSprite(config.label, config.color, 32);
        raritySprite.position.y = -1.0;
        raritySprite.material.opacity = 0;
        group.add(raritySprite);

        // Spawn burst particles for rare+
        if (config.confetti) {
          for (let i = 0; i < 20; i++) {
            const pMat = new THREE.SpriteMaterial({
              map: glowTex,
              transparent: true,
              depthTest: false,
              blending: THREE.AdditiveBlending,
              opacity: 0.8,
              color: new THREE.Color(config.color),
            });
            const pSprite = new THREE.Sprite(pMat);
            pSprite.scale.set(0.15, 0.15, 0.15);
            pSprite.position.set(0, 0, 0);
            group.add(pSprite);
            burstParticles.push({
              sprite: pSprite,
              velocity: new THREE.Vector3(
                (Math.random() - 0.5) * 4,
                (Math.random() - 0.5) * 4,
                (Math.random() - 0.5) * 4,
              ),
              age: 0,
            });
          }
        }
      }
    } else if (phase === 'reveal') {
      revealTime += delta;

      // Scale up the item
      if (currentSprite) {
        const targetScale = 1.2;
        const s = currentSprite.scale.x;
        if (s < targetScale) {
          const newS = Math.min(targetScale, s + delta * 2);
          currentSprite.scale.set(newS, newS, newS);
        }
        currentSprite.position.y = Math.sin(elapsed * 2) * 0.05;
      }

      // Fade in glow
      if (glowSprite) {
        glowSprite.material.opacity = Math.min(0.7, revealTime * 1.5);
        glowSprite.scale.set(
          2.5 + Math.sin(elapsed * 3) * 0.3,
          2.5 + Math.sin(elapsed * 3) * 0.3,
          1,
        );
      }

      // Fade in name and rarity
      if (nameSprite) {
        nameSprite.material.opacity = Math.min(1, (revealTime - 0.3) * 3);
      }
      if (raritySprite) {
        raritySprite.material.opacity = Math.min(1, (revealTime - 0.5) * 3);
      }

      // Update burst particles
      for (const bp of burstParticles) {
        bp.age += delta;
        bp.sprite.position.addScaledVector(bp.velocity, delta);
        bp.velocity.multiplyScalar(0.96);
        bp.sprite.material.opacity = Math.max(0, 0.8 - bp.age * 0.8);
        const pScale = 0.15 + bp.age * 0.1;
        bp.sprite.scale.set(pScale, pScale, pScale);
      }

      if (revealTime > 3.5) {
        phase = 'fade';
        fadeTime = 0;
      }
    } else if (phase === 'fade') {
      fadeTime += delta;
      const fadeProgress = Math.min(1, fadeTime / 1.0);

      if (currentSprite) currentSprite.material.opacity = 1 - fadeProgress;
      if (glowSprite) glowSprite.material.opacity = 0.7 * (1 - fadeProgress);
      if (nameSprite) nameSprite.material.opacity = 1 - fadeProgress;
      if (raritySprite) raritySprite.material.opacity = 1 - fadeProgress;
      for (const bp of burstParticles) {
        bp.sprite.material.opacity *= 0.9;
      }

      // Move everything up as it fades
      group.position.y += delta * 0.5;

      if (fadeTime > 1.2) {
        // Cleanup
        group.traverse((child: THREE.Object3D) => {
          if (child instanceof THREE.Sprite) {
            child.material.dispose();
          }
        });
        scene.remove(group);
        return false; // effect is done
      }
    }

    return true; // still running
  };

  return { group, update };
}
