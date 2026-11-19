export type Rgb = readonly [number, number, number];

export interface SkyKey {
  hour: number;
  top: string;
  horizon: string;
  bottom: string;
  light: string;
  lightIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  fog: string;
}

export interface SkyState {
  top: string;
  horizon: string;
  bottom: string;
  lightColor: string;
  lightIntensity: number;
  lightDir: [number, number, number];
  sunDir: [number, number, number];
  sunVisible: boolean;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  fog: string;
  night: number;
  lamps: number;
}

export const SKY_KEYS: readonly SkyKey[] = [
  { hour: 0, top: '#050818', horizon: '#141a3d', bottom: '#050818', light: '#7f93ff', lightIntensity: 0.35, hemiSky: '#2b3a7a', hemiGround: '#0d1022', hemiIntensity: 0.45, fog: '#10163a' },
  { hour: 5, top: '#0b1030', horizon: '#2a2a62', bottom: '#0b1030', light: '#8a9bff', lightIntensity: 0.3, hemiSky: '#2f3d80', hemiGround: '#10132b', hemiIntensity: 0.45, fog: '#1b2150' },
  { hour: 6.3, top: '#4a4f9a', horizon: '#ff9a76', bottom: '#2b2f6b', light: '#ffb98a', lightIntensity: 1.1, hemiSky: '#9fa8e6', hemiGround: '#6b5a66', hemiIntensity: 0.7, fog: '#f2a98a' },
  { hour: 8, top: '#3d86d8', horizon: '#bfe3f5', bottom: '#8fc4e8', light: '#fff0d6', lightIntensity: 2.4, hemiSky: '#b8dcff', hemiGround: '#7d7461', hemiIntensity: 0.85, fog: '#bfe3f5' },
  { hour: 12, top: '#2a78d6', horizon: '#a8dcf5', bottom: '#8cc8ea', light: '#fffaf0', lightIntensity: 3.0, hemiSky: '#bfe0ff', hemiGround: '#857b66', hemiIntensity: 0.9, fog: '#a8dcf5' },
  { hour: 16.3, top: '#3b82d0', horizon: '#ffd9a0', bottom: '#8cb8e0', light: '#ffd9a0', lightIntensity: 2.6, hemiSky: '#c9d9f5', hemiGround: '#8a7560', hemiIntensity: 0.8, fog: '#ffd9a0' },
  { hour: 17.7, top: '#5b4fa8', horizon: '#ff8a4c', bottom: '#4a3a82', light: '#ff9a55', lightIntensity: 2.0, hemiSky: '#c9a0d8', hemiGround: '#7a5a62', hemiIntensity: 0.75, fog: '#ff9566' },
  { hour: 18.6, top: '#2b2766', horizon: '#e0506f', bottom: '#241d55', light: '#ff7a6a', lightIntensity: 0.9, hemiSky: '#7a62b0', hemiGround: '#4a3550', hemiIntensity: 0.6, fog: '#c24b6e' },
  { hour: 19.6, top: '#0f1240', horizon: '#5a3a86', bottom: '#0d1038', light: '#9aa6ff', lightIntensity: 0.4, hemiSky: '#3f4a96', hemiGround: '#1c1a3a', hemiIntensity: 0.5, fog: '#3a2a6a' },
  { hour: 21, top: '#070a24', horizon: '#1a1f55', bottom: '#070a24', light: '#8396ff', lightIntensity: 0.35, hemiSky: '#2d3b82', hemiGround: '#0f1226', hemiIntensity: 0.45, fog: '#141a48' },
  { hour: 24, top: '#050818', horizon: '#141a3d', bottom: '#050818', light: '#7f93ff', lightIntensity: 0.35, hemiSky: '#2b3a7a', hemiGround: '#0d1022', hemiIntensity: 0.45, fog: '#10163a' },
];

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export const lerpHex = (a: string, b: string, t: number): string => {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
};

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
};

export const wrapHour = (hours: number) => ((hours % 24) + 24) % 24;

/** Sun height as a sine: 0 at 06:00 and 18:00, 1 at noon, negative at night. */
export function sunElevation(hours: number): number {
  return Math.sin(((wrapHour(hours) - 6) / 12) * Math.PI);
}

function sunDirection(hours: number): [number, number, number] {
  const a = ((wrapHour(hours) - 6) / 12) * Math.PI;
  const x = 0.55 * Math.cos(a);
  const y = Math.sin(a) * 0.9 + 0.02;
  const z = -Math.cos(a);
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}

export function skyAt(hoursRaw: number): SkyState {
  const hours = wrapHour(hoursRaw);
  let k = 0;
  while (k < SKY_KEYS.length - 2 && hours >= SKY_KEYS[k + 1]!.hour) k++;
  const a = SKY_KEYS[k]!;
  const b = SKY_KEYS[k + 1]!;
  const t = (hours - a.hour) / (b.hour - a.hour);
  const mix = (key: 'top' | 'horizon' | 'bottom' | 'hemiSky' | 'hemiGround' | 'fog') => lerpHex(a[key], b[key], t);
  const elevation = sunElevation(hours);
  const sunDir = sunDirection(hours);
  const sunUp = elevation > 0;
  const moonDir: [number, number, number] = [-sunDir[0], Math.abs(sunDir[1]) + 0.35, -sunDir[2]];
  const lightDir = sunUp && elevation > 0.04 ? sunDir : moonDir;
  return {
    top: mix('top'),
    horizon: mix('horizon'),
    bottom: mix('bottom'),
    lightColor: lerpHex(a.light, b.light, t),
    lightIntensity: a.lightIntensity + (b.lightIntensity - a.lightIntensity) * t,
    lightDir,
    sunDir,
    sunVisible: elevation > -0.08,
    hemiSky: mix('hemiSky'),
    hemiGround: mix('hemiGround'),
    hemiIntensity: a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * t,
    fog: mix('fog'),
    night: 1 - smoothstep(-0.12, 0.05, elevation),
    lamps: 1 - smoothstep(0.02, 0.2, elevation),
  };
}

export function formatClock(hoursRaw: number): string {
  const hours = wrapHour(hoursRaw);
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${suffix}`;
}
