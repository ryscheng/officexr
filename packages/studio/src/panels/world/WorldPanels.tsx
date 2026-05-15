import React, { useEffect } from 'react';
import type { Actions } from '@officexr/sdk';
import type { BotMode } from '@officexr/world/bot';

import { Button } from '../../components/ui/button.tsx';
import {
  ColorInput,
  NumberInput,
  Panel,
  Section,
  SelectInput,
  Toggle,
  Vector3Input,
} from '../../ui/controls/index.ts';
import type { AuxLightType, ViewConfig } from './types.ts';
import type { UseStudioSettingsResult } from './useStudioSettings.ts';

interface WorldPanelsProps {
  settings: UseStudioSettingsResult;
  actions: Actions | null;
  /** Page-level handlers — Debug app routes bot count to in-browser
   *  pool or promotes to WS mode + the Node CLI. */
  onBotCountChange: (count: number) => void;
  onBotModeChange: (mode: BotMode) => void;
}

/**
 * Right-hand panel stack for Debug mode. Replaces the 8 Leva panels
 * that used to live in `packages/world/src/renderer/panels/*`:
 *   Animation, Proximity, Lighting, Background, FixedCamera, World,
 *   Bot, Settings.
 *
 * Each section is a fully-controlled React component. Edits flow:
 *   - **Renderer-local fields** → `setSection(...)` updates the
 *     view-config; `<Scene>` re-reads it on every render.
 *   - **Synced fields** (animation speeds, proximity radii, sun
 *     intensity, world grid size) → ALSO call into the SDK
 *     `actions.setWorldSettings(...)` or `actions.setWorldMap(...)`
 *     so peers + bots see the updated values.
 *
 * The `WorldPanels` component itself is intentionally a render-only
 * wrapper — all the mirror-to-SDK effects live inside the inner
 * panel components so they can subscribe to just the fields they own.
 */
export function WorldPanels({
  settings,
  actions,
  onBotCountChange,
  onBotModeChange,
}: WorldPanelsProps) {
  const { viewConfig, setSection, reset, exportJson } = settings;

  return (
    <Panel>
      <BotPanel
        bot={viewConfig.bot}
        setSection={setSection}
        onBotCountChange={onBotCountChange}
        onBotModeChange={onBotModeChange}
      />
      <AnimationPanel
        animation={viewConfig.animation}
        setSection={setSection}
        actions={actions}
      />
      <ProximityPanel
        proximity={viewConfig.proximity}
        setSection={setSection}
        actions={actions}
      />
      <LightingPanel
        lighting={viewConfig.lighting}
        setSection={setSection}
        actions={actions}
      />
      <BackgroundPanel
        background={viewConfig.background}
        setSection={setSection}
      />
      <FixedCameraPanel
        fixedCamera={viewConfig.fixedCamera}
        setSection={setSection}
      />
      <SettingsPanel reset={reset} exportJson={exportJson} />
    </Panel>
  );
}

// --- Bot ----------------------------------------------------------

interface BotPanelProps {
  bot: ViewConfig['bot'];
  setSection: UseStudioSettingsResult['setSection'];
  onBotCountChange: (count: number) => void;
  onBotModeChange: (mode: BotMode) => void;
}

const BOT_MODES: ReadonlyArray<{ id: BotMode; label: string }> = [
  { id: 'idle', label: 'Stay' },
  { id: 'walk-to-local', label: 'Walk to me' },
  { id: 'walk-away', label: 'Walk away' },
  { id: 'wander', label: 'Wander' },
  { id: 'patrol', label: 'Patrol' },
  { id: 'orbit', label: 'Orbit' },
];

function BotPanel({
  bot,
  setSection,
  onBotCountChange,
  onBotModeChange,
}: BotPanelProps) {
  return (
    <Section title="Bot">
      <NumberInput
        label="count"
        value={bot.count}
        min={0}
        max={10}
        step={1}
        digits={0}
        onChange={(count) => {
          setSection('bot', (prev) => ({ ...prev, count }));
          onBotCountChange(count);
        }}
      />
      <div className="grid grid-cols-2 gap-1 px-3 py-1.5">
        {BOT_MODES.map((mode) => (
          <Button
            key={mode.id}
            variant={bot.mode === mode.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setSection('bot', (prev) => ({ ...prev, mode: mode.id }));
              onBotModeChange(mode.id);
            }}
          >
            {mode.label}
          </Button>
        ))}
      </div>
    </Section>
  );
}

// --- Animation ----------------------------------------------------

interface AnimationPanelProps {
  animation: ViewConfig['animation'];
  setSection: UseStudioSettingsResult['setSection'];
  actions: Actions | null;
}

function AnimationPanel({ animation, setSection, actions }: AnimationPanelProps) {
  useEffect(() => {
    if (!actions) return;
    actions.setWorldSettings({
      playerSpeed: animation.playerSpeed,
      runSpeedMultiplier: animation.runMultiplier,
      walkAnimSpeed: animation.walkSpeed,
      runAnimSpeed: animation.runSpeed,
      idleAnimSpeed: animation.idleSpeed,
      turnSpeed: animation.turnSpeed,
      movementBlockThreshold: animation.movementBlockThreshold,
    });
  }, [
    actions,
    animation.playerSpeed,
    animation.runMultiplier,
    animation.walkSpeed,
    animation.runSpeed,
    animation.idleSpeed,
    animation.turnSpeed,
    animation.movementBlockThreshold,
  ]);

  const set =
    <K extends keyof ViewConfig['animation']>(key: K) =>
    (value: ViewConfig['animation'][K]) =>
      setSection('animation', (prev) => ({ ...prev, [key]: value }));

  return (
    <Section title="Animation" defaultOpen={false}>
      <NumberInput label="idle ×" value={animation.idleSpeed} min={0.1} max={3} step={0.05} onChange={set('idleSpeed')} />
      <NumberInput label="walk anim ×" value={animation.walkSpeed} min={0.1} max={10} step={0.05} onChange={set('walkSpeed')} />
      <NumberInput label="run anim ×" value={animation.runSpeed} min={0.1} max={10} step={0.05} onChange={set('runSpeed')} />
      <NumberInput label="turn (rad/s)" value={animation.turnSpeed} min={1} max={60} step={0.5} onChange={set('turnSpeed')} />
      <NumberInput label="walk (m/s)" value={animation.playerSpeed} min={0.5} max={15} step={0.1} onChange={set('playerSpeed')} />
      <NumberInput label="run × walk" value={animation.runMultiplier} min={1} max={6} step={0.1} onChange={set('runMultiplier')} />
      <NumberInput label="block thresh" value={animation.movementBlockThreshold} min={0} max={1} step={0.01} onChange={set('movementBlockThreshold')} />
    </Section>
  );
}

// --- Proximity ----------------------------------------------------

interface ProximityPanelProps {
  proximity: ViewConfig['proximity'];
  setSection: UseStudioSettingsResult['setSection'];
  actions: Actions | null;
}

function ProximityPanel({ proximity, setSection, actions }: ProximityPanelProps) {
  useEffect(() => {
    if (!actions) return;
    actions.setWorldSettings({
      proximityRadius: proximity.sensorRadius,
      proximityOuterRadius: proximity.outerRadius,
      proximityEnterDebounceMs: proximity.enterDebounceMs,
      conversationCameraDistance: proximity.conversationDistance,
      conversationCameraHeight: proximity.conversationHeight,
    });
  }, [
    actions,
    proximity.sensorRadius,
    proximity.outerRadius,
    proximity.enterDebounceMs,
    proximity.conversationDistance,
    proximity.conversationHeight,
  ]);

  const set =
    <K extends keyof ViewConfig['proximity']>(key: K) =>
    (value: ViewConfig['proximity'][K]) =>
      setSection('proximity', (prev) => ({ ...prev, [key]: value }));

  return (
    <Section title="Proximity" defaultOpen={false}>
      <NumberInput label="inner (m)" value={proximity.sensorRadius} min={0.5} max={20} step={0.1} onChange={set('sensorRadius')} />
      <NumberInput label="outer (m)" value={proximity.outerRadius} min={1} max={30} step={0.1} onChange={set('outerRadius')} />
      <NumberInput label="enter delay (ms)" value={proximity.enterDebounceMs} min={0} max={2000} step={10} onChange={set('enterDebounceMs')} />
      <NumberInput label="disc (m)" value={proximity.discRadius} min={0.2} max={5} step={0.05} onChange={set('discRadius')} />
      <NumberInput label="pulse (Hz)" value={proximity.pulseSpeed} min={0.05} max={4} step={0.05} onChange={set('pulseSpeed')} />
      <NumberInput label="intensity" value={proximity.intensity} min={0} max={3} step={0.05} onChange={set('intensity')} />
      <ColorInput label="entering" value={proximity.enteringColor} onChange={set('enteringColor')} />
      <ColorInput label="entered" value={proximity.enteredColor} onChange={set('enteredColor')} />
      <ColorInput label="exiting" value={proximity.exitingColor} onChange={set('exitingColor')} />
      <NumberInput label="border inset" value={proximity.meetingBorderInset} min={0} max={2} step={0.01} onChange={set('meetingBorderInset')} />
      <NumberInput label="border outset" value={proximity.meetingBorderOutset} min={0} max={2} step={0.01} onChange={set('meetingBorderOutset')} />
      <NumberInput label="bubble speed" value={proximity.sparkleSpeed} min={0} max={8} step={0.1} onChange={set('sparkleSpeed')} />
      <NumberInput label="bubble height" value={proximity.sparkleFloatHeight} min={0.1} max={6} step={0.1} onChange={set('sparkleFloatHeight')} />
      <NumberInput label="convo dist" value={proximity.conversationDistance} min={2} max={30} step={0.25} onChange={set('conversationDistance')} />
      <NumberInput label="convo height" value={proximity.conversationHeight} min={1} max={30} step={0.25} onChange={set('conversationHeight')} />
      <NumberInput label="sparkle ×" value={proximity.sparkleSize} min={0.2} max={10} step={0.1} onChange={set('sparkleSize')} />
    </Section>
  );
}

// --- Lighting -----------------------------------------------------

interface LightingPanelProps {
  lighting: ViewConfig['lighting'];
  setSection: UseStudioSettingsResult['setSection'];
  actions: Actions | null;
}

const SHADOW_MAP_SIZES: ReadonlyArray<{ value: '512' | '1024' | '2048' | '4096'; label: string }> = [
  { value: '512', label: '512' },
  { value: '1024', label: '1024' },
  { value: '2048', label: '2048' },
  { value: '4096', label: '4096' },
];

const AUX_LIGHT_TYPES: ReadonlyArray<AuxLightType> = ['none', 'spot', 'point'];

function LightingPanel({ lighting, setSection, actions }: LightingPanelProps) {
  useEffect(() => {
    if (!actions) return;
    const [sx, sy, sz] = lighting.sunPosition;
    actions.setWorldSettings({
      sunPositionX: sx,
      sunPositionY: sy,
      sunPositionZ: sz,
      sunIntensity: lighting.sunIntensity,
      ambientIntensity: lighting.ambientIntensity,
    });
  }, [
    actions,
    lighting.sunPosition,
    lighting.sunIntensity,
    lighting.ambientIntensity,
  ]);

  const set =
    <K extends keyof ViewConfig['lighting']>(key: K) =>
    (value: ViewConfig['lighting'][K]) =>
      setSection('lighting', (prev) => ({ ...prev, [key]: value }));

  return (
    <Section title="Lighting" defaultOpen={false}>
      <Vector3Input
        label="sun position"
        value={lighting.sunPosition}
        step={1}
        onChange={set('sunPosition')}
      />
      <ColorInput label="sun color" value={lighting.sunColor} onChange={set('sunColor')} />
      <NumberInput label="sun intensity" value={lighting.sunIntensity} min={0} max={3} step={0.05} onChange={set('sunIntensity')} />
      <NumberInput label="ambient fill" value={lighting.ambientIntensity} min={0} max={1} step={0.01} onChange={set('ambientIntensity')} />
      <Toggle label="cast shadow" value={lighting.castShadow} onChange={set('castShadow')} />
      <NumberInput label="shadow range (m)" value={lighting.shadowRange} min={5} max={200} step={1} onChange={set('shadowRange')} />
      <SelectInput
        label="shadow res"
        value={String(lighting.shadowMapSize) as '512' | '1024' | '2048' | '4096'}
        options={SHADOW_MAP_SIZES}
        onChange={(v) => set('shadowMapSize')(Number(v))}
      />
      <NumberInput label="shadow bias" value={lighting.shadowBias} min={-0.002} max={0.002} step={0.0001} digits={4} onChange={set('shadowBias')} />
      <NumberInput label="shadow nbias" value={lighting.shadowNormalBias} min={0} max={0.1} step={0.001} digits={3} onChange={set('shadowNormalBias')} />
      <SelectInput
        label="aux light"
        value={lighting.auxLightType}
        options={AUX_LIGHT_TYPES}
        onChange={(v) => set('auxLightType')(v as AuxLightType)}
      />
      <NumberInput label="aux intensity" value={lighting.auxIntensity} min={0} max={10} step={0.1} onChange={set('auxIntensity')} />
      <NumberInput label="aux distance" value={lighting.auxDistance} min={0} max={500} step={5} onChange={set('auxDistance')} />
      <NumberInput label="spot angle" value={lighting.auxAngle} min={0.1} max={Math.PI / 2} step={0.01} onChange={set('auxAngle')} />
      <NumberInput label="spot penumbra" value={lighting.auxPenumbra} min={0} max={1} step={0.01} onChange={set('auxPenumbra')} />
      <NumberInput label="falloff decay" value={lighting.auxDecay} min={0} max={4} step={0.1} onChange={set('auxDecay')} />
      <Toggle label="sun disc" value={lighting.showSunDisc} onChange={set('showSunDisc')} />
      <NumberInput label="disc radius" value={lighting.sunDiscRadius} min={0.2} max={30} step={0.1} onChange={set('sunDiscRadius')} />
      <NumberInput label="disc glow" value={lighting.sunDiscIntensity} min={0} max={10} step={0.1} onChange={set('sunDiscIntensity')} />
    </Section>
  );
}

// --- Background ---------------------------------------------------

function BackgroundPanel({
  background,
  setSection,
}: {
  background: ViewConfig['background'];
  setSection: UseStudioSettingsResult['setSection'];
}) {
  const set =
    <K extends keyof ViewConfig['background']>(key: K) =>
    (value: ViewConfig['background'][K]) =>
      setSection('background', (prev) => ({ ...prev, [key]: value }));
  return (
    <Section title="Background" defaultOpen={false}>
      <ColorInput label="top" value={background.topColor} onChange={set('topColor')} />
      <ColorInput label="bottom" value={background.bottomColor} onChange={set('bottomColor')} />
    </Section>
  );
}

// --- Fixed camera -------------------------------------------------

function FixedCameraPanel({
  fixedCamera,
  setSection,
}: {
  fixedCamera: ViewConfig['fixedCamera'];
  setSection: UseStudioSettingsResult['setSection'];
}) {
  const set =
    <K extends keyof ViewConfig['fixedCamera']>(key: K) =>
    (value: ViewConfig['fixedCamera'][K]) =>
      setSection('fixedCamera', (prev) => ({ ...prev, [key]: value }));
  return (
    <Section title="Fixed camera" defaultOpen={false}>
      <NumberInput label="azimuth (°)" value={fixedCamera.azimuthDeg} min={0} max={360} step={0.5} onChange={set('azimuthDeg')} />
      <NumberInput label="pitch (°)" value={fixedCamera.pitchDeg} min={-89} max={89} step={0.5} onChange={set('pitchDeg')} />
      <NumberInput label="height (Y)" value={fixedCamera.height} min={0} max={200} step={0.5} onChange={set('height')} />
      <NumberInput label="near (screen %)" value={fixedCamera.maxOnScreenFrac} min={0.05} max={0.6} step={0.005} digits={3} onChange={set('maxOnScreenFrac')} />
      <NumberInput label="far (screen %)" value={fixedCamera.minOnScreenFrac} min={0.01} max={0.3} step={0.005} digits={3} onChange={set('minOnScreenFrac')} />
      <NumberInput label="lateral (frac)" value={fixedCamera.lateralFrac} min={0} max={1} step={0.01} onChange={set('lateralFrac')} />
      <NumberInput label="fov" value={fixedCamera.fov} min={20} max={110} step={1} digits={0} onChange={set('fov')} />
      <NumberInput label="WASD offset (°)" value={fixedCamera.movementYawOffsetDeg} min={-180} max={180} step={0.5} onChange={set('movementYawOffsetDeg')} />
    </Section>
  );
}

// --- Settings -----------------------------------------------------

function SettingsPanel({
  reset,
  exportJson,
}: {
  reset: () => void;
  exportJson: () => void;
}) {
  return (
    <Section title="Settings" defaultOpen={false}>
      <div className="flex flex-col gap-1.5 px-3 py-2">
        <Button variant="secondary" size="sm" onClick={exportJson}>
          Export JSON
        </Button>
        <Button variant="outline" size="sm" onClick={reset}>
          Reset to defaults
        </Button>
      </div>
    </Section>
  );
}
