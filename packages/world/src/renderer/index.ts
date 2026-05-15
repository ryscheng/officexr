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
export { ObjectInstances } from './ObjectInstances.tsx';
// Renderer-side helpers re-exported for editor overlays (e.g. the
// Room editor's GhostLayer needs to build a transparent material from
// the same GLTF geometry the opaque InstancedMesh uses).
export {
  buildMaterialForKind,
  extractGeometryFromGltf,
  extractMaterialFromGltf,
  hasMaterialOverrides,
} from './cube-material.ts';
export { EndlessGrid } from './EndlessGrid.tsx';

export {
  CAMERA_MODES,
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
