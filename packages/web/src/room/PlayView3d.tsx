import { useEffect, useState, type ReactNode } from 'react';
import type { PersistentLocalState } from '@officexr/core-refactor';
import { PlayView, type PlayViewProps } from '@officexr/world/react';
import { createWorldXRStore, useXRSessionModeSupported, type CameraMode, type XRStore } from '@officexr/world/renderer';
import { Switch } from '../hud/ui/Switch';
import { CharacterLook } from './CharacterLook';
import { MotionLookControl } from './MotionLookControl';
import { SettingRow } from '../hud/settings/parts';
import { PerfReadout } from '../perf/PerfReadout';
import { publishFrameStats } from '../perf/perfStats';
import { useShowPerformance } from '../perf/perfSetting';
import { angleHeld, cameraModeOf, forgetLegacyJoystickChoice, storedOpenView, viewOfCameraMode, type GameView, type OpenView } from './gameView';
import type { SettingsAction } from './Settings';
import { ViewPicker } from './ViewPicker';
import { vrActions } from './VrAction';

/** Created in an effect so StrictMode's remount destroys the first store, which appends a DOM overlay. */
function useWorldXRStore(): XRStore | undefined {
  const [store, setStore] = useState<XRStore>();
  useEffect(() => {
    const created = createWorldXRStore();
    setStore(created);
    return () => created.destroy();
  }, []);
  return store;
}

/**
 * The 2D view: the same 3D scene through the fixed follow camera, swung due south and tilted
 * steeply down so the office reads like a floor plan (Gather-style). A long lens from high up
 * keeps walls from leaning. Wheel and pinch zoom.
 */
const OVERHEAD_CAMERA = {
  azimuthDeg: 180,
  pitchDeg: -65,
  height: 60,
  fov: 20,
  centred: true,
} as const;

const BIRDS_EYE_CAMERA = { ...OVERHEAD_CAMERA, pitchDeg: -89.9 } as const;

const ANGLED_CAMERA = { centred: true } as const;

const fixedCameraOf = (view: GameView) =>
  view === 'map' ? OVERHEAD_CAMERA : view === 'birds-eye' ? BIRDS_EYE_CAMERA : view === 'angled' ? ANGLED_CAMERA : undefined;

export interface PlayViewSettings {
  controls: ReactNode;
  motion: ReactNode;
  look: ReactNode;
  actions: SettingsAction[];
  joystickFloats: boolean;
}

/** Everything that reaches three/R3F, lazily loaded by `OfficeWorld`. */
export default function PlayView3d({
  viewProps,
  overhead,
  local,
  onError,
  children,
}: {
  viewProps: Pick<
    PlayViewProps,
    'store' | 'actions' | 'rules' | 'bus' | 'sync' | 'handshake' | 'selfId' | 'mapName' | 'title' | 'loading' | 'renderLoadError' | 'storages' | 'onPingPlayer' | 'onPingFrozen' | 'placement' | 'missionMarker'
  >;
  /** The 2D view: lock the camera overhead instead of offering camera modes. */
  overhead: boolean;
  local: PersistentLocalState;
  onError: (message: string | null) => void;
  children: (settings: PlayViewSettings) => ReactNode;
}) {
  const [openView, setOpenView] = useState<OpenView>(storedOpenView);
  const view: GameView = overhead ? 'map' : openView;
  const cameraMode = cameraModeOf(view);
  const setCameraMode = (mode: CameraMode) => setOpenView((current) => viewOfCameraMode(mode, current));
  const [motionLook, setMotionLook] = useState({ enabled: false, recenterKey: 0 });
  const [motionUnsupported, setMotionUnsupported] = useState(false);
  const [invertLook, setInvertLook] = useState(false);
  useEffect(forgetLegacyJoystickChoice, []);
  const showPerformance = useShowPerformance();
  const xrStore = useWorldXRStore();
  const vrSupported = useXRSessionModeSupported('immersive-vr') === true;
  const lookLocked = angleHeld(view, motionLook.enabled);

  const controls = (
    <>
      <ViewPicker value={view} onOpenView={setOpenView} />
      <SettingRow label="Invert look">
        <Switch aria-label="Invert look" checked={invertLook} onCheckedChange={setInvertLook} />
      </SettingRow>
    </>
  );
  const motion = (
    <SettingRow label="Motion look">
      <MotionLookControl
        enabled={motionLook.enabled}
        onEnabledChange={(enabled) => setMotionLook((m) => ({ ...m, enabled }))}
        onRecenter={() => setMotionLook((m) => ({ ...m, recenterKey: m.recenterKey + 1 }))}
        unsupported={motionUnsupported}
        onUnsupported={() => setMotionUnsupported(true)}
      />
    </SettingRow>
  );
  const settings: PlayViewSettings = {
    controls,
    motion,
    look: <CharacterLook local={local} onSaveResult={onError} />,
    actions: vrActions(xrStore, vrSupported, onError),
    joystickFloats: lookLocked,
  };

  return (
    <>
    <PlayView
      {...viewProps}
      realtime="ws"
      cameraMode={cameraMode}
      onCameraModeChange={overhead ? undefined : setCameraMode}
      fixedCamera={fixedCameraOf(view)}
      motionLook={motionLook}
      invertLook={invertLook}
      lookLocked={lookLocked}
      hud="player"
      xrStore={xrStore}
      onFrameStats={showPerformance ? publishFrameStats : undefined}
    >
      {children(settings)}
    </PlayView>
    {showPerformance && <PerfReadout mode={cameraMode} />}
    </>
  );
}
