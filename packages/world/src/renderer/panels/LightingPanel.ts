import { useEffect } from 'react';
import { useControls } from 'leva';
import type { Actions } from '@officexr/sdk';

export type AuxLightType = 'none' | 'spot' | 'point';

export interface LightingPanelValues {
  sunPosition: [number, number, number];
  sunColor: string;
  sunIntensity: number;
  ambientIntensity: number;
  castShadow: boolean;
  shadowRange: number;
  shadowMapSize: number;
  shadowBias: number;
  shadowNormalBias: number;
  auxLightType: AuxLightType;
  auxIntensity: number;
  auxDistance: number;
  auxAngle: number;
  auxPenumbra: number;
  auxDecay: number;
  showSunDisc: boolean;
  sunDiscRadius: number;
  sunDiscIntensity: number;
}

/**
 * Leva "Lighting" panel. The sun position + intensities are broadcast
 * via worldSettings so every peer sees the same time-of-day; the
 * shadow-camera knobs, aux-light, and sun-disc visuals stay local
 * (rendering-only).
 */
export function useLightingPanel(actions: Actions): LightingPanelValues {
  const values = useControls('Lighting', {
    sunPosition: { value: [20, 40, 20], label: 'sun position' },
    sunColor: { value: '#ffffff', label: 'sun colour' },
    sunIntensity: { value: 1.4, min: 0, max: 3, step: 0.05, label: 'sun intensity' },
    ambientIntensity: { value: 0.15, min: 0, max: 1, step: 0.01, label: 'ambient fill' },
    castShadow: { value: true, label: 'cast shadow' },
    /** Half-size (m) of the shadow camera frustum, centred on the
     * local player. The shadow camera follows the player so this is
     * an upper bound on how far from the player we render shadows —
     * regardless of how big the map is. Auto-clamped to the floor's
     * half-diagonal so small floors don't waste shadow-map texels on
     * empty space. Bigger value = shadows visible further away, but
     * each shadow-map texel covers more world units (blockier). */
    shadowRange: {
      value: 40,
      min: 5,
      max: 200,
      step: 1,
      label: 'shadow range (m)',
    },
    shadowMapSize: {
      value: 2048,
      options: { '512': 512, '1024': 1024, '2048': 2048, '4096': 4096 },
      label: 'shadow res',
    },
    shadowBias: {
      value: -0.0005,
      min: -0.002,
      max: 0.002,
      step: 0.0001,
      label: 'shadow bias',
    },
    shadowNormalBias: {
      value: 0.02,
      min: 0,
      max: 0.1,
      step: 0.001,
      label: 'shadow nbias',
    },
    // Optional secondary light co-located with the directional sun, to
    // fake the look of a visible "star" — a localised hotspot or radial
    // glow on top of the real (parallel-ray) sunlight. The directional
    // light is always emitted; this just adds extra illumination near
    // the sun's position. Defaults to `none` so it stays opt-in.
    auxLightType: {
      value: 'none' as AuxLightType,
      options: ['none', 'spot', 'point'] as const,
      label: 'aux light',
    },
    auxIntensity: { value: 1, min: 0, max: 10, step: 0.1, label: 'aux intensity' },
    /** Spot/point falloff distance (0 = infinite range). */
    auxDistance: { value: 0, min: 0, max: 500, step: 5, label: 'aux distance' },
    /** Spot light cone half-angle (radians). */
    auxAngle: { value: Math.PI / 6, min: 0.1, max: Math.PI / 2, step: 0.01, label: 'spot angle' },
    /** Spot light edge softness. */
    auxPenumbra: { value: 0.2, min: 0, max: 1, step: 0.01, label: 'spot penumbra' },
    /** Distance falloff exponent (physical = 2). */
    auxDecay: { value: 2, min: 0, max: 4, step: 0.1, label: 'falloff decay' },
    /** Visible "sun" — an emissive sphere placed at sunPosition so
     * the user sees a star/disc in the sky aligned with the shadow
     * direction. Renders as a self-lit sphere via emissive material
     * so it stays bright regardless of how much ambient or sun light
     * hits it. */
    showSunDisc: { value: true, label: 'sun disc' },
    sunDiscRadius: { value: 3, min: 0.2, max: 30, step: 0.1, label: 'disc radius' },
    sunDiscIntensity: { value: 2, min: 0, max: 10, step: 0.1, label: 'disc glow' },
  });

  useEffect(() => {
    const [sx, sy, sz] = values.sunPosition;
    actions.setWorldSettings({
      sunPositionX: sx,
      sunPositionY: sy,
      sunPositionZ: sz,
      sunIntensity: values.sunIntensity,
      ambientIntensity: values.ambientIntensity,
    });
  }, [
    actions,
    values.sunPosition,
    values.sunIntensity,
    values.ambientIntensity,
  ]);

  return values;
}
