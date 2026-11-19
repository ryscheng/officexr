import type { ObjectInstance } from '@officexr/sdk';
import type { KindResolver } from '../app/geometry-service.ts';
import type { InstanceGeometryService } from '../app/types.ts';

export interface WaterVolume {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  baseY: number;
  surfaceY: number;
}

export function waterVolumes(
  instances: readonly ObjectInstance[],
  catalog: Pick<KindResolver, 'getKind'>,
  geometry: Pick<InstanceGeometryService, 'worldAABBOfInstance'>,
): WaterVolume[] {
  const volumes: WaterVolume[] = [];
  for (const instance of instances) {
    const water = catalog.getKind(instance.kindId)?.water;
    if (!water || (instance.yawDeg ?? 0) % 90 !== 0) {
      continue;
    }
    const { min, max } = geometry.worldAABBOfInstance(instance);
    volumes.push({
      id: instance.id,
      minX: min[0] + water.rim,
      maxX: max[0] - water.rim,
      minZ: min[2] + water.rim,
      maxZ: max[2] - water.rim,
      baseY: min[1],
      surfaceY: min[1] + water.surfaceHeight,
    });
  }
  return volumes;
}

export function waterAt(volumes: readonly WaterVolume[], x: number, z: number): WaterVolume | null {
  return volumes.find((v) => x >= v.minX && x <= v.maxX && z >= v.minZ && z <= v.maxZ) ?? null;
}
