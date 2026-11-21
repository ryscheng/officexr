import type { Spot } from './missions/missionRows';

export type MapBox = { x: number; z: number; w: number; h: number };

type Rect = { left: number; top: number; width: number; height: number };

export function clientToMap(rect: Rect, box: MapBox, clientX: number, clientY: number): Spot {
  const scale = Math.min(rect.width / box.w, rect.height / box.h);
  const marginX = (rect.width - box.w * scale) / 2;
  const marginY = (rect.height - box.h * scale) / 2;
  return {
    x: box.x + (clientX - rect.left - marginX) / scale,
    z: box.z + (clientY - rect.top - marginY) / scale,
  };
}
