import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { currentVisual, type Store } from '@officexr/sdk';
import { feetPosition } from '../physics/rules.ts';

const POOL = 56;
const HEAD_M = 1.75;
const SMOKE_PER_S = 9;
const SPARKLE_PER_S = 26;

interface Particle {
  alive: boolean;
  age: number;
  life: number;
  smoke: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  hue: number;
}

/** Smoke rising from a singed head and sparkles around a colour-burst target. */
export function SpellAuras({ store }: { store: Store }) {
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const particles = useMemo<Particle[]>(
    () => Array.from({ length: POOL }, (_, i) => ({ alive: false, age: 0, life: 1, smoke: i < POOL / 2, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, hue: 0 })),
    [],
  );
  const owed = useRef<Map<string, number>>(new Map());
  const smokeMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#4a4440', transparent: true, depthWrite: false, fog: false }), []);
  const sparkMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), []);

  const spawn = (p: Partial<Particle> & { smoke: boolean }) => {
    const slot = particles.find((q) => !q.alive && q.smoke === p.smoke);
    if (slot) Object.assign(slot, { alive: true, age: 0 }, p);
  };

  useFrame((_, dt) => {
    const state = store.getState();
    const now = performance.now();
    for (const [id, player] of Object.entries(state.players)) {
      const visual = currentVisual(state.spellEffects, id, now);
      if (!visual || (!visual.smoke && !visual.sparkles)) {
        owed.current.delete(id);
        continue;
      }
      const rate = visual.smoke ? SMOKE_PER_S : SPARKLE_PER_S;
      const due = (owed.current.get(id) ?? 0) + dt * rate;
      const count = Math.floor(due);
      owed.current.set(id, due - count);
      const feet = feetPosition(player.pos, state.worldSettings.charRadius);
      for (let i = 0; i < count; i++) {
        const head = feet.y + HEAD_M * visual.scale + visual.lift;
        if (visual.smoke) {
          spawn({ smoke: true, life: 1.1, x: player.pos.x + (Math.random() - 0.5) * 0.25, y: head, z: player.pos.z + (Math.random() - 0.5) * 0.25, vx: (Math.random() - 0.5) * 0.15, vy: 0.55 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.15 });
        } else {
          const a = Math.random() * Math.PI * 2;
          spawn({ smoke: false, life: 0.7, hue: Math.random(), x: player.pos.x + Math.cos(a) * 0.5, y: feet.y + (0.2 + Math.random() * 1.5) * visual.scale + visual.lift, z: player.pos.z + Math.sin(a) * 0.5, vx: 0, vy: 0.5, vz: 0 });
        }
      }
    }
    particles.forEach((p, i) => {
      const m = meshes.current[i];
      if (!m) return;
      if (p.alive) {
        p.age += dt;
        if (p.age >= p.life) p.alive = false;
      }
      m.visible = p.alive;
      if (!p.alive) return;
      const k = p.age / p.life;
      m.position.set(p.x + p.vx * p.age, p.y + p.vy * p.age, p.z + p.vz * p.age);
      m.scale.setScalar(p.smoke ? 0.08 + k * 0.2 : 0.045 * (1 - k) + 0.01);
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = p.smoke ? (1 - k) * 0.6 : 1 - k;
      if (!p.smoke) mat.color.setHSL(p.hue, 0.95, 0.65);
    });
  });

  return (
    <group renderOrder={11}>
      {particles.map((_, i) => (
        <mesh key={i} ref={(m) => void (meshes.current[i] = m)} material={(i < POOL / 2 ? smokeMat : sparkMat).clone()} visible={false}>
          <sphereGeometry args={[1, 8, 6]} />
        </mesh>
      ))}
    </group>
  );
}
