import { useEffect, useState, type ReactNode } from 'react';
import type { PersistentLocalState } from '@officexr/core-refactor';
import { PlayView, type PlayViewProps } from '@officexr/world/react';
import { createWorldXRStore, useXRSessionModeSupported, type CameraMode, type XRStore } from '@officexr/world/renderer';
import { useCoarsePointer } from '@officexr/world/top-down';
import { useJoystickMode, type JoystickMode } from '../hud/joystickMode';
import { SegmentedControl } from '../hud/ui/SegmentedControl';
import { Switch } from '../hud/ui/Switch';
import { CameraModeControl } from './CameraModeControl';
import { CharacterLook } from './CharacterLook';
import { MotionLookControl } from './MotionLookControl';
import { SettingRow } from '../hud/settings/parts';
import type { SettingsAction } from './Settings';
import { vrActions } from './VrAction';

const JOYSTICK_OPTIONS = [
  { value: 'floating', label: 'Floating' },
  { value: 'fixed', label: 'Fixed' },
] as const;

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
 * keeps walls from leaning, and the pinned distance puts you at the centre: the look ray at
 * `pitchDeg` passes through your chest, (height − 0.9 m) / tan(65°) away. Wheel and pinch zoom.
 */
const OVERHEAD_HEIGHT_M = 60;
const OVERHEAD_PITCH_DEG = -65;
const OVERHEAD_CAMERA = {
  azimuthDeg: 180,
  pitchDeg: OVERHEAD_PITCH_DEG,
  height: OVERHEAD_HEIGHT_M,
  fov: 20,
  distanceM: (OVERHEAD_HEIGHT_M - 0.9) / Math.tan((-OVERHEAD_PITCH_DEG * Math.PI) / 180),
} as const;

/** The settings content that needs this view's camera, look and VR state. */
export interface PlayViewSettings {
  controls: ReactNode;
  look: ReactNode;
  actions: SettingsAction[];
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
  const [cameraMode, setCameraMode] = useState<CameraMode>('fixed');
  const [motionLook, setMotionLook] = useState({ enabled: false, recenterKey: 0 });
  const [motionUnsupported, setMotionUnsupported] = useState(false);
  const [invertLook, setInvertLook] = useState(false);
  const [joystick, setJoystick] = useJoystickMode();
  const coarse = useCoarsePointer();
  const xrStore = useWorldXRStore();
  const vrSupported = useXRSessionModeSupported('immersive-vr') === true;

  const controls = (
    <>
      {!overhead && (
        <SettingRow label="Camera">
          <CameraModeControl value={cameraMode} onChange={setCameraMode} />
        </SettingRow>
      )}
      <SettingRow label="Motion look">
        <MotionLookControl
          enabled={motionLook.enabled}
          onEnabledChange={(enabled) => setMotionLook((m) => ({ ...m, enabled }))}
          onRecenter={() => setMotionLook((m) => ({ ...m, recenterKey: m.recenterKey + 1 }))}
          unsupported={motionUnsupported}
          onUnsupported={() => setMotionUnsupported(true)}
        />
      </SettingRow>
      {coarse && (
        <SettingRow label="Joystick">
          <SegmentedControl<JoystickMode>
            aria-label="Joystick"
            value={joystick}
            options={JOYSTICK_OPTIONS}
            onValueChange={setJoystick}
          />
        </SettingRow>
      )}
      <SettingRow label="Invert look">
        <Switch aria-label="Invert look" checked={invertLook} onCheckedChange={setInvertLook} />
      </SettingRow>
    </>
  );
  const settings: PlayViewSettings = {
    controls,
    look: <CharacterLook local={local} onSaveResult={onError} />,
    actions: vrActions(xrStore, vrSupported, onError),
  };

  return (
    <PlayView
      {...viewProps}
      realtime="ws"
      cameraMode={overhead ? 'fixed' : cameraMode}
      onCameraModeChange={overhead ? undefined : setCameraMode}
      fixedCamera={overhead ? OVERHEAD_CAMERA : undefined}
      motionLook={motionLook}
      invertLook={invertLook}
      joystick={joystick}
      hud="player"
      xrStore={xrStore}
    >
      {children(settings)}
    </PlayView>
  );
}
