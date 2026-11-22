import { createContext, useContext, useEffect, type RefObject } from 'react';
import type * as THREE from 'three';
import type { OccluderRegistry } from './OccluderRegistry.ts';

// Null outside a gameplay scene, so editors and previews register nothing.
export const OccluderRegistryContext = createContext<OccluderRegistry | null>(null);

export function useOccluderRegistry(): OccluderRegistry | null {
  return useContext(OccluderRegistryContext);
}

export function useInstancedOccluder(
  meshRef: RefObject<THREE.InstancedMesh | null>,
  count: number,
  instances: readonly { id: string }[],
  material: unknown,
): void {
  const registry = useOccluderRegistry();
  useEffect(() => {
    const mesh = meshRef.current;
    if (!registry || !mesh || count === 0) return;
    return registry.addInstanced(
      mesh,
      count,
      instances.map((i) => i.id),
    );
  }, [registry, meshRef, count, instances, material]);
}
