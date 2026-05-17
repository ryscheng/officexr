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
export { MapColliders } from './MapColliders.tsx';
export { GradientBackground } from './GradientBackground.tsx';
export { ProximityGlow } from './ProximityGlow.tsx';
export { CameraRig } from './CameraRig.tsx';
export { SceneFrame } from './SceneFrame.tsx';
export { ObjectInstances, type MaterialOverride } from './ObjectInstances.tsx';
export {
  LightingRig,
  DEFAULT_EDITOR_LIGHTING,
  type LightingSettings,
} from './LightingRig.tsx';
export { EditorCamera } from './EditorCamera.tsx';
// Renderer-side helpers re-exported for editor overlays (e.g. the
// Room editor's GhostLayer needs to build a transparent material from
// the same GLTF geometry the opaque InstancedMesh uses).
// `hasMaterialOverrides` stays internal to `cube-material.ts` (its
// test reaches in directly) — no external editor consumes it.
export {
  buildMaterialForKind,
  extractGeometryFromGltf,
  extractMaterialFromGltf,
  getKindBoundingDimensions,
  type KindBoundingDimensions,
} from './cube-material.ts';
export { EndlessGrid } from './EndlessGrid.tsx';

export {
  CAMERA_MODES,
  VOXEL_SIZE,
  CUBE_SIZE,
  CHARACTERS,
  PLAYER_HEIGHT,
  FIXED_CAMERA_DEFAULTS,
  TOP_DOWN_CAMERA_DEFAULTS,
  FREE_FLY_DEFAULTS,
  type CameraMode,
  type CharacterName,
} from './config.ts';

// ViewConfig: the renderer-tweaker bag Scene takes. Editing UI for
// these fields lives in the studio package
// (`packages/studio/src/panels/world/`) — world stays panel-UI-free.
export type {
  AuxLightType,
  ViewConfig,
  ProximityViewConfig,
  LightingViewConfig,
  BackgroundViewConfig,
  FixedCameraViewConfig,
} from './viewConfig.ts';
