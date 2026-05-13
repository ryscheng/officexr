// Public renderer surface. Anything imported by `@officexr/studio` (or
// future shells) goes here; renderer-internal helpers are only exported
// when a sibling sub-package needs them.

export { Scene } from './Scene.tsx';
export {
  Adventurer,
  STATE_CLIPS,
  isAnimationStateAvailable,
  type AnimationState,
} from './Adventurer.tsx';
export { Players } from './Players.tsx';
export { Floor } from './Floor.tsx';
export { FloorColliders } from './FloorColliders.tsx';
export { GradientBackground } from './GradientBackground.tsx';
export { ProximityGlow } from './ProximityGlow.tsx';
export { CameraRig } from './CameraRig.tsx';
export { SceneFrame } from './SceneFrame.tsx';
export { ObjectInstances } from './ObjectInstances.tsx';
export { EndlessGrid } from './EndlessGrid.tsx';

export {
  CAMERA_MODES,
  CUBE_SIZE,
  WORLD,
  CHARACTERS,
  PLAYER_HEIGHT,
  FIXED_CAMERA_DEFAULTS,
  TOP_DOWN_CAMERA_DEFAULTS,
  FREE_FLY_DEFAULTS,
  type CameraMode,
  type CharacterName,
} from './config.ts';

export {
  useLevaPersistence,
  exportLevaConfig,
  resetLevaConfig,
} from './levaPersistence.ts';

// Per-panel hooks. Studio's DebugMode mounts these unchanged; future
// modes can mount a subset.
export {
  useAnimationPanel,
  type AnimationPanelValues,
} from './panels/AnimationPanel.ts';
export {
  useProximityPanel,
  type ProximityPanelValues,
} from './panels/ProximityPanel.ts';
export {
  useLightingPanel,
  type AuxLightType,
  type LightingPanelValues,
} from './panels/LightingPanel.ts';
export {
  useBackgroundPanel,
  type BackgroundPanelValues,
} from './panels/BackgroundPanel.ts';
export {
  useBotPanel,
  type BotPanelOptions,
  type BotPanelValues,
} from './panels/BotPanel.ts';
export {
  useFixedCameraPanel,
  type FixedCameraPanelValues,
} from './panels/FixedCameraPanel.ts';
export {
  useWorldPanel,
  type WorldPanelValues,
} from './panels/WorldPanel.ts';
export { useSettingsPanel } from './panels/SettingsPanel.ts';
