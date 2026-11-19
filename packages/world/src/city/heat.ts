export interface HeatMeter {
  value: number;
  quiet: number;
}

export const MAX_HEAT = 5;
const COOL_DELAY = 6;
const COOL_RATE = 0.14;

export const createHeat = (): HeatMeter => ({ value: 0, quiet: 0 });

export function bumpHeat(heat: HeatMeter, amount: number): void {
  heat.value = Math.min(MAX_HEAT, heat.value + amount);
  heat.quiet = 0;
}

export function coolHeat(heat: HeatMeter, dt: number): void {
  heat.quiet += dt;
  if (heat.quiet > COOL_DELAY) heat.value = Math.max(0, heat.value - COOL_RATE * dt);
}

export const heatStars = (heat: HeatMeter): number => Math.ceil(heat.value - 1e-6);
