import { useEffect, useState, type ReactNode } from 'react';
import type { PersistentLocalState } from '@officexr/core-refactor';
import { PlayView } from '@officexr/world/react';
import { createWorldXRStore, useXRSessionModeSupported, type CameraMode, type XRStore } from '@officexr/world/renderer';
import type { TopDownPlayViewProps } from '@officexr/world/top-down';
import { Switch } from '../hud/ui/Switch';
import { CameraModeControl } from './CameraModeControl';
import { CharacterDialog } from './CharacterDialog';
import { MotionLookControl } from './MotionLookControl';
import type { SettingsAction, SettingsTab } from './Settings';
import { closingAction, SettingRow, SettingsModal } from './SettingsModal';
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

/** Everything that reaches three/R3F, so `OfficeWorld` can load it only in 3D. */
export default function PlayView3d({
  viewProps,
  local,
  settings,
  onError,
  children,
}: {
  viewProps: Omit<TopDownPlayViewProps, 'children'>;
  local: PersistentLocalState;
  /** Settings shared with the 2D view. */
  settings: { tabs: SettingsTab[]; actions: SettingsAction[] };
  onError: (message: string | null) => void;
  children: ReactNode;
}) {
  const [cameraMode, setCameraMode] = useState<CameraMode>('fixed');
  const [motionLook, setMotionLook] = useState({ enabled: false, recenterKey: 0 });
  const [motionUnsupported, setMotionUnsupported] = useState(false);
  const [invertLook, setInvertLook] = useState(false);
  const [characterOpen, setCharacterOpen] = useState(false);
  const xrStore = useWorldXRStore();
  const vrSupported = useXRSessionModeSupported('immersive-vr') === true;

  const controls = (
    <>
      <SettingRow label="Camera">
        <CameraModeControl value={cameraMode} onChange={setCameraMode} />
      </SettingRow>
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
    closingAction('character', 'Character', () => setCharacterOpen(true)),
    ...vrActions(xrStore, vrSupported, onError),
  ];

  return (
    <PlayView
      {...viewProps}
      realtime="ws"
      cameraMode={cameraMode}
      onCameraModeChange={setCameraMode}
      motionLook={motionLook}
      invertLook={invertLook}
      hud="player"
      xrStore={xrStore}
    >
      <SettingsModal
        title={viewProps.title}
        tabs={[...settings.tabs, { id: 'controls', label: 'Controls', content: controls }]}
        actions={[...settings.actions, ...actions]}
      />
      {characterOpen && <CharacterDialog local={local} onSaveResult={onError} onClose={() => setCharacterOpen(false)} />}
      {children}
    </PlayView>
  );
}
