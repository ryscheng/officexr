import { useEffect, useRef } from 'react';
import { folder, useControls } from 'leva';
import type {
  MapDocumentV1,
  MapEnvironment,
} from '@officexr/world/scenes';
import { HDRI_PRESETS, type HdriPresetName } from './environment-presets.ts';

interface UseEnvironmentPanelOpts {
  /** The active environment block. The hook reads initial values from
   * this and pushes onChange edits back via `setEnvironment`. Re-keyed
   * on `mapName` so the panel rebuilds when the user switches maps. */
  mapName: string;
  environment: MapEnvironment;
  setEnvironment: (
    update: (env: MapEnvironment) => MapEnvironment,
  ) => void;
}

/**
 * Leva panel that owns the Map editor's `MapEnvironment` block:
 * directional sun, drei `<Sky>`, drei `<Stars>`, drei `<Environment>`
 * (HDRI). Each section is a separate Leva folder so the user can
 * collapse what they're not editing.
 *
 * Every onChange writes through `setEnvironment` into the map
 * document, which auto-saves to `/api/maps/<name>` after the 500ms
 * debounce — the canvas re-reads `doc.environment` on the next React
 * frame.
 *
 * SOLID note (ISP): this hook deliberately takes ONLY the
 * environment + setter + mapName so it doesn't have to know about
 * rooms, spawns, etc. The MapApp passes only what's needed.
 */
export function useEnvironmentPanel({
  mapName,
  environment,
  setEnvironment,
}: UseEnvironmentPanelOpts): void {
  // Latest setter in a ref so onChange closures stay stable for the
  // lifetime of a single Leva panel (matches the pattern used by
  // KindEditor in the Object editor).
  const setRef = useRef(setEnvironment);
  useEffect(() => {
    setRef.current = setEnvironment;
  }, [setEnvironment]);

  // Re-mount the whole schema per-map. Without `mapName` in the
  // dep key Leva tries to share slider values across loaded maps,
  // which makes "switch map" feel like the sliders are stuck.
  const key = mapName;

  useControls(
    'Environment',
    () => {
      const env = environment;
      const skyEnabled = env.sky !== null;
      const starsEnabled = env.stars !== null;
      const hdriEnabled = env.hdri !== null;
      // Treat preset selection as the canonical "name". When
      // `hdri.url` is one of the preset slugs we round-trip; an
      // unknown url shows up as 'none' until the user picks a preset.
      const hdriPreset: HdriPresetName =
        hdriEnabled && env.hdri && (HDRI_PRESETS as readonly string[]).includes(env.hdri.url)
          ? (env.hdri.url as HdriPresetName)
          : 'none';

      return {
        ambient: {
          value: env.ambientIntensity,
          min: 0,
          max: 1,
          step: 0.01,
          onChange: (v: number) =>
            setRef.current((e) => ({ ...e, ambientIntensity: v })),
        },
        sun: folder(
          {
            sunIntensity: {
              label: 'intensity',
              value: env.sun.intensity,
              min: 0,
              max: 4,
              step: 0.05,
              onChange: (v: number) =>
                setRef.current((e) => ({
                  ...e,
                  sun: { ...e.sun, intensity: v },
                })),
            },
            sunColor: {
              label: 'color',
              value: env.sun.color,
              onChange: (v: string) =>
                setRef.current((e) => ({
                  ...e,
                  sun: { ...e.sun, color: v },
                })),
            },
            sunX: {
              label: 'x',
              value: env.sun.positionX,
              min: -100,
              max: 100,
              step: 0.5,
              onChange: (v: number) =>
                setRef.current((e) => ({
                  ...e,
                  sun: { ...e.sun, positionX: v },
                })),
            },
            sunY: {
              label: 'y',
              value: env.sun.positionY,
              min: 0,
              max: 200,
              step: 0.5,
              onChange: (v: number) =>
                setRef.current((e) => ({
                  ...e,
                  sun: { ...e.sun, positionY: v },
                })),
            },
            sunZ: {
              label: 'z',
              value: env.sun.positionZ,
              min: -100,
              max: 100,
              step: 0.5,
              onChange: (v: number) =>
                setRef.current((e) => ({
                  ...e,
                  sun: { ...e.sun, positionZ: v },
                })),
            },
          },
          { collapsed: false },
        ),
        sky: folder(
          {
            'sky enabled': {
              value: skyEnabled,
              onChange: (enabled: boolean) =>
                setRef.current((e) => ({
                  ...e,
                  sky: enabled
                    ? (e.sky ?? {
                        enabled: true,
                        turbidity: 10,
                        rayleigh: 3,
                        inclination: 0.49,
                        azimuth: 0.25,
                      })
                    : null,
                })),
            },
            turbidity: {
              value: env.sky?.turbidity ?? 10,
              min: 0,
              max: 20,
              step: 0.1,
              onChange: (v: number) =>
                setRef.current((e) =>
                  e.sky ? { ...e, sky: { ...e.sky, turbidity: v } } : e,
                ),
            },
            rayleigh: {
              value: env.sky?.rayleigh ?? 3,
              min: 0,
              max: 4,
              step: 0.05,
              onChange: (v: number) =>
                setRef.current((e) =>
                  e.sky ? { ...e, sky: { ...e.sky, rayleigh: v } } : e,
                ),
            },
            inclination: {
              value: env.sky?.inclination ?? 0.49,
              min: 0,
              max: 1,
              step: 0.001,
              onChange: (v: number) =>
                setRef.current((e) =>
                  e.sky ? { ...e, sky: { ...e.sky, inclination: v } } : e,
                ),
            },
            azimuth: {
              value: env.sky?.azimuth ?? 0.25,
              min: 0,
              max: 1,
              step: 0.001,
              onChange: (v: number) =>
                setRef.current((e) =>
                  e.sky ? { ...e, sky: { ...e.sky, azimuth: v } } : e,
                ),
            },
          },
          { collapsed: true },
        ),
        stars: folder(
          {
            'stars enabled': {
              value: starsEnabled,
              onChange: (enabled: boolean) =>
                setRef.current((e) => ({
                  ...e,
                  stars: enabled
                    ? (e.stars ?? {
                        enabled: true,
                        radius: 100,
                        depth: 50,
                        count: 5000,
                        factor: 4,
                        saturation: 0,
                        fade: true,
                      })
                    : null,
                })),
            },
            radius: {
              value: env.stars?.radius ?? 100,
              min: 10,
              max: 500,
              step: 1,
              onChange: (v: number) =>
                setRef.current((e) =>
                  e.stars ? { ...e, stars: { ...e.stars, radius: v } } : e,
                ),
            },
            count: {
              value: env.stars?.count ?? 5000,
              min: 100,
              max: 20000,
              step: 100,
              onChange: (v: number) =>
                setRef.current((e) =>
                  e.stars ? { ...e, stars: { ...e.stars, count: v } } : e,
                ),
            },
            factor: {
              value: env.stars?.factor ?? 4,
              min: 0,
              max: 10,
              step: 0.1,
              onChange: (v: number) =>
                setRef.current((e) =>
                  e.stars ? { ...e, stars: { ...e.stars, factor: v } } : e,
                ),
            },
            fade: {
              value: env.stars?.fade ?? true,
              onChange: (v: boolean) =>
                setRef.current((e) =>
                  e.stars ? { ...e, stars: { ...e.stars, fade: v } } : e,
                ),
            },
          },
          { collapsed: true },
        ),
        hdri: folder(
          {
            preset: {
              value: hdriPreset,
              options: Object.fromEntries(HDRI_PRESETS.map((p) => [p, p])),
              onChange: (preset: HdriPresetName) =>
                setRef.current((e) => ({
                  ...e,
                  hdri:
                    preset === 'none'
                      ? null
                      : {
                          url: preset,
                          intensity: e.hdri?.intensity ?? 1,
                          background: e.hdri?.background ?? false,
                        },
                })),
            },
            hdriIntensity: {
              label: 'intensity',
              value: env.hdri?.intensity ?? 1,
              min: 0,
              max: 4,
              step: 0.05,
              onChange: (v: number) =>
                setRef.current((e) =>
                  e.hdri ? { ...e, hdri: { ...e.hdri, intensity: v } } : e,
                ),
            },
            'use as background': {
              value: env.hdri?.background ?? false,
              onChange: (v: boolean) =>
                setRef.current((e) =>
                  e.hdri ? { ...e, hdri: { ...e.hdri, background: v } } : e,
                ),
            },
          },
          { collapsed: true },
        ),
      } as unknown as Record<string, never>;
    },
    [key],
  );
}

// Trivial type re-export so MapApp can import the doc-level reducer
// type signature next to the hook.
export type EnvironmentSetter = (
  update: (env: MapDocumentV1['environment']) => MapDocumentV1['environment'],
) => void;
