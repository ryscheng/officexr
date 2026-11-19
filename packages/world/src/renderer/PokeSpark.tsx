import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

export const POKE_SPARK_DELAY_S = 0.1;
export const POKE_SPARK_LIFE_S = 0.55;
const RAYS = 6;

export function sparkProgress(age: number): number {
  return Math.min(1, Math.max(0, (age - POKE_SPARK_DELAY_S) / POKE_SPARK_LIFE_S));
}

export function PokeSpark({ position, onDone }: { position: [number, number, number]; onDone: () => void }) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const age = useRef(0);
  const finished = useRef(false);
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#fff3a0', transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide }),
    [],
  );
  const rays = useMemo(() => Array.from({ length: RAYS }, (_, i) => (i / RAYS) * Math.PI * 2), []);

  useFrame(({ camera }, dt) => {
    age.current += dt;
    const t = sparkProgress(age.current);
    const g = group.current;
    if (!g) return;
    g.visible = age.current >= POKE_SPARK_DELAY_S;
    g.quaternion.copy(camera.quaternion);
    g.scale.setScalar(0.7 + t * 1.1);
    material.opacity = 1 - t;
    if (t >= 1 && !finished.current) {
      finished.current = true;
      onDone();
    }
  });

  return (
    <group ref={group} position={position} visible={false} renderOrder={10}>
      <mesh ref={ring} material={material}>
        <ringGeometry args={[0.16, 0.2, 24]} />
      </mesh>
      {rays.map((a) => (
        <mesh key={a} material={material} position={[Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0]} rotation={[0, 0, a]}>
          <planeGeometry args={[0.14, 0.04]} />
        </mesh>
      ))}
    </group>
  );
}
