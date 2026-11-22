export const ROOF_CLEARANCE = 2.2;
export const NAMED_ROOF_CLEARANCE = 1.9;
export const ROOF_REACH = 60;
export const CUTAWAY_RADIUS = 14;
export const CUT_PLANE_SLACK = 0.02;

const ROOF_NAME = /roof|ceiling/i;

export function isRoofName(name: unknown): boolean {
  return typeof name === 'string' && ROOF_NAME.test(name);
}

export function roofClearance(named: boolean): number {
  return named ? NAMED_ROOF_CLEARANCE : ROOF_CLEARANCE;
}

export function isOverheadCover(bottomY: number, feetY: number, named: boolean): boolean {
  return bottomY >= feetY + roofClearance(named);
}

export function isAboveCutPlane(bottomY: number, cutY: number): boolean {
  return bottomY >= cutY - CUT_PLANE_SLACK;
}

export function withinCutawayRadius(dx: number, dz: number, objectRadius: number): boolean {
  const r = CUTAWAY_RADIUS + objectRadius;
  return dx * dx + dz * dz <= r * r;
}
