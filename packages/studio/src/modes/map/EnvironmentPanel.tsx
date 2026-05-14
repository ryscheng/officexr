import React from 'react';
import type { MapEnvironment } from '@officexr/world/scenes';

import {
  ColorInput,
  NumberInput,
  Panel,
  Section,
  SelectInput,
  Toggle,
} from '../../ui/controls/index.ts';
import { HDRI_PRESETS, type HdriPresetName } from './environment-presets.ts';

interface EnvironmentPanelProps {
  environment: MapEnvironment;
  setEnvironment: (update: (env: MapEnvironment) => MapEnvironment) => void;
}

/**
 * Right-hand panel for the Map editor. Replaces the previous
 * `useEnvironmentPanel` Leva hook with a fully-controlled React
 * panel built on the shadcn-based control kit. Five collapsible
 * sections:
 *
 *   - ambient + sun (always-on lighting)
 *   - sky (drei <Sky>; enable toggle gates the rest)
 *   - stars (drei <Stars>; enable toggle gates the rest)
 *   - hdri (drei <Environment>; preset dropdown with 'none' sentinel
 *     collapses to `hdri = null`)
 *
 * Edits route through `setEnvironment(update => next)`, which the
 * caller (`useMapDocument.setEnvironment`) applies to the in-memory
 * map document — the document is then auto-saved with the existing
 * debounce.
 */
export function EnvironmentPanel({
  environment: env,
  setEnvironment,
}: EnvironmentPanelProps) {
  // Local default templates so enable-toggle ↔ off ↔ on doesn't
  // lose any tuning the user did while a section was enabled.
  const DEFAULT_SKY = {
    enabled: true,
    turbidity: 10,
    rayleigh: 3,
    inclination: 0.49,
    azimuth: 0.25,
  } as const;
  const DEFAULT_STARS = {
    enabled: true,
    radius: 100,
    depth: 50,
    count: 5000,
    factor: 4,
    saturation: 0,
    fade: true,
  } as const;

  const hdriPreset: HdriPresetName =
    env.hdri && (HDRI_PRESETS as readonly string[]).includes(env.hdri.url)
      ? (env.hdri.url as HdriPresetName)
      : 'none';

  return (
    <Panel>
      <Section title="Lighting">
        <NumberInput
          label="ambient"
          value={env.ambientIntensity}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) =>
            setEnvironment((e) => ({ ...e, ambientIntensity: v }))
          }
        />
        <NumberInput
          label="sun intensity"
          value={env.sun.intensity}
          min={0}
          max={4}
          step={0.05}
          onChange={(v) =>
            setEnvironment((e) => ({ ...e, sun: { ...e.sun, intensity: v } }))
          }
        />
        <ColorInput
          label="sun color"
          value={env.sun.color}
          onChange={(color) =>
            setEnvironment((e) => ({ ...e, sun: { ...e.sun, color } }))
          }
        />
        <NumberInput
          label="sun x"
          value={env.sun.positionX}
          min={-100}
          max={100}
          step={0.5}
          onChange={(v) =>
            setEnvironment((e) => ({ ...e, sun: { ...e.sun, positionX: v } }))
          }
        />
        <NumberInput
          label="sun y"
          value={env.sun.positionY}
          min={0}
          max={200}
          step={0.5}
          onChange={(v) =>
            setEnvironment((e) => ({ ...e, sun: { ...e.sun, positionY: v } }))
          }
        />
        <NumberInput
          label="sun z"
          value={env.sun.positionZ}
          min={-100}
          max={100}
          step={0.5}
          onChange={(v) =>
            setEnvironment((e) => ({ ...e, sun: { ...e.sun, positionZ: v } }))
          }
        />
      </Section>

      <Section
        title="Sky"
        defaultOpen={false}
        enabled={env.sky !== null}
        onEnabledChange={(on) =>
          setEnvironment((e) => ({
            ...e,
            sky: on ? (e.sky ?? { ...DEFAULT_SKY }) : null,
          }))
        }
      >
        {env.sky ? (
          <>
            <NumberInput
              label="turbidity"
              value={env.sky.turbidity}
              min={0}
              max={20}
              step={0.1}
              onChange={(v) =>
                setEnvironment((e) =>
                  e.sky ? { ...e, sky: { ...e.sky, turbidity: v } } : e,
                )
              }
            />
            <NumberInput
              label="rayleigh"
              value={env.sky.rayleigh}
              min={0}
              max={4}
              step={0.05}
              onChange={(v) =>
                setEnvironment((e) =>
                  e.sky ? { ...e, sky: { ...e.sky, rayleigh: v } } : e,
                )
              }
            />
            <NumberInput
              label="inclination"
              value={env.sky.inclination}
              min={0}
              max={1}
              step={0.001}
              onChange={(v) =>
                setEnvironment((e) =>
                  e.sky ? { ...e, sky: { ...e.sky, inclination: v } } : e,
                )
              }
            />
            <NumberInput
              label="azimuth"
              value={env.sky.azimuth}
              min={0}
              max={1}
              step={0.001}
              onChange={(v) =>
                setEnvironment((e) =>
                  e.sky ? { ...e, sky: { ...e.sky, azimuth: v } } : e,
                )
              }
            />
          </>
        ) : null}
      </Section>

      <Section
        title="Stars"
        defaultOpen={false}
        enabled={env.stars !== null}
        onEnabledChange={(on) =>
          setEnvironment((e) => ({
            ...e,
            stars: on ? (e.stars ?? { ...DEFAULT_STARS }) : null,
          }))
        }
      >
        {env.stars ? (
          <>
            <NumberInput
              label="radius"
              value={env.stars.radius}
              min={10}
              max={500}
              step={1}
              onChange={(v) =>
                setEnvironment((e) =>
                  e.stars ? { ...e, stars: { ...e.stars, radius: v } } : e,
                )
              }
            />
            <NumberInput
              label="count"
              value={env.stars.count}
              min={100}
              max={20000}
              step={100}
              onChange={(v) =>
                setEnvironment((e) =>
                  e.stars ? { ...e, stars: { ...e.stars, count: v } } : e,
                )
              }
            />
            <NumberInput
              label="factor"
              value={env.stars.factor}
              min={0}
              max={10}
              step={0.1}
              onChange={(v) =>
                setEnvironment((e) =>
                  e.stars ? { ...e, stars: { ...e.stars, factor: v } } : e,
                )
              }
            />
            <Toggle
              label="fade"
              value={env.stars.fade}
              onChange={(v) =>
                setEnvironment((e) =>
                  e.stars ? { ...e, stars: { ...e.stars, fade: v } } : e,
                )
              }
            />
          </>
        ) : null}
      </Section>

      <Section title="HDRI" defaultOpen={false}>
        <SelectInput
          label="preset"
          value={hdriPreset}
          options={HDRI_PRESETS}
          onChange={(preset) =>
            setEnvironment((e) => ({
              ...e,
              hdri:
                preset === 'none'
                  ? null
                  : {
                      url: preset,
                      intensity: e.hdri?.intensity ?? 1,
                      background: e.hdri?.background ?? false,
                    },
            }))
          }
        />
        {env.hdri ? (
          <>
            <NumberInput
              label="intensity"
              value={env.hdri.intensity}
              min={0}
              max={4}
              step={0.05}
              onChange={(v) =>
                setEnvironment((e) =>
                  e.hdri ? { ...e, hdri: { ...e.hdri, intensity: v } } : e,
                )
              }
            />
            <Toggle
              label="background"
              value={env.hdri.background}
              onChange={(v) =>
                setEnvironment((e) =>
                  e.hdri ? { ...e, hdri: { ...e.hdri, background: v } } : e,
                )
              }
            />
          </>
        ) : null}
      </Section>
    </Panel>
  );
}
