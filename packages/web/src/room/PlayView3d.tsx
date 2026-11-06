import { useEffect, useState, type ReactNode } from 'react';
import type { PersistentLocalState } from '@officexr/core-refactor';
import { PlayView } from '@officexr/world/react';
import { createWorldXRStore, useXRSessionModeSupported, type CameraMode, type XRStore } from '@officexr/world/renderer';
import type { TopDownPlayViewProps } from '@officexr/world/top-down';
import { CameraModeMenuItem } from './CameraModeMenuItem';
import { CharacterDialog, CharacterMenuItem } from './CharacterDialog';
import { MotionLookMenuItem } from './MotionLookMenuItem';
import { RoomMenu, RoomMenuChoice } from './RoomMenu';
import { VrMenuItem } from './VrMenuItem';

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
  menu,
  onError,
  children,
}: {
  viewProps: Omit<TopDownPlayViewProps, 'children'>;
  local: PersistentLocalState;
  /** Menu items shared with the 2D view. */
  menu: ReactNode;
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
      <RoomMenu>
        <CameraModeMenuItem value={cameraMode} onChange={setCameraMode} />
        <MotionLookMenuItem
          enabled={motionLook.enabled}
          onEnabledChange={(enabled) => setMotionLook((m) => ({ ...m, enabled }))}
          onRecenter={() => setMotionLook((m) => ({ ...m, recenterKey: m.recenterKey + 1 }))}
          unsupported={motionUnsupported}
          onUnsupported={() => setMotionUnsupported(true)}
        />
        <RoomMenuChoice>
          <input
            type="checkbox"
            role="switch"
            checked={invertLook}
            onChange={(e) => setInvertLook(e.target.checked)}
          />
          Invert look
        </RoomMenuChoice>
        <CharacterMenuItem onSelect={() => setCharacterOpen(true)} />
        {menu}
        {xrStore && <VrMenuItem supported={vrSupported} store={xrStore} onError={onError} />}
      </RoomMenu>
      {characterOpen && <CharacterDialog local={local} onSaveResult={onError} onClose={() => setCharacterOpen(false)} />}
      {children}
    </PlayView>
  );
}
