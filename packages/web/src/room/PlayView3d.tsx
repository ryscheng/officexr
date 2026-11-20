import { useEffect, useState, type ReactNode } from 'react';
import type { PersistentLocalState } from '@officexr/core-refactor';
import { PlayView, type PlayViewProps } from '@officexr/world/react';
import { createWorldXRStore, useXRSessionModeSupported, type CameraMode, type XRStore } from '@officexr/world/renderer';
import { Switch } from '../hud/ui/Switch';
import { CameraModeControl } from './CameraModeControl';
import { CharacterAction, CharacterPane } from './CharacterPane';
import { MotionLookControl } from './MotionLookControl';
import type { SettingsAction, SettingsTab } from './Settings';
import { SettingRow, SettingsModal } from './SettingsModal';
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

/** Everything that reaches three/R3F, lazily loaded by `OfficeWorld`. */
export default function PlayView3d({
  viewProps,
  overhead,
  local,
  settings,
  onError,
  children,
}: {
  viewProps: Pick<
    PlayViewProps,
    'store' | 'actions' | 'rules' | 'bus' | 'sync' | 'handshake' | 'selfId' | 'mapName' | 'title' | 'storages' | 'onPingPlayer' | 'onPingFrozen' | 'placement'
  >;
  /** The 2D view: lock the camera overhead instead of offering camera modes. */
  overhead: boolean;
  local: PersistentLocalState;
  /** Settings tabs and actions from the office (view, keybinds, notifications, office). */
  settings: { tabs: SettingsTab[]; actions: SettingsAction[] };
  onError: (message: string | null) => void;
  children: ReactNode;
}) {
  const [cameraMode, setCameraMode] = useState<CameraMode>('fixed');
  const [motionLook, setMotionLook] = useState({ enabled: false, recenterKey: 0 });
  const [motionUnsupported, setMotionUnsupported] = useState(false);
  const [invertLook, setInvertLook] = useState(false);
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
      <SettingRow label="Invert look">
        <Switch aria-label="Invert look" checked={invertLook} onCheckedChange={setInvertLook} />
      </SettingRow>
    </>
  );
  const actions: SettingsAction[] = [
    { id: 'character', render: () => <CharacterAction /> },
    ...vrActions(xrStore, vrSupported, onError),
  ];

  return (
    <PlayView
      {...viewProps}
      realtime="ws"
      cameraMode={overhead ? 'fixed' : cameraMode}
      onCameraModeChange={overhead ? undefined : setCameraMode}
      fixedCamera={overhead ? OVERHEAD_CAMERA : undefined}
      motionLook={motionLook}
      invertLook={invertLook}
      hud="player"
      xrStore={xrStore}
    >
      <SettingsModal
        title={viewProps.title}
        tabs={[...settings.tabs, { id: 'controls', label: 'Controls', content: controls }]}
        panes={[
          { id: 'character', label: 'Character', content: <CharacterPane local={local} onSaveResult={onError} /> },
        ]}
        actions={[...settings.actions, ...actions]}
      />
      {children}
    </PlayView>
  );
}
