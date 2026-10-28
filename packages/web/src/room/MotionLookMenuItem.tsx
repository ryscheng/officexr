import { useState } from 'react';
import { requestMotionPermission, type MotionPermission } from '@officexr/world/renderer';
import { RoomMenuChoice, RoomMenuItem } from './RoomMenu';

const DENIED_MESSAGE = 'Motion access denied — enable it in Safari settings';
const UNSUPPORTED_MESSAGE = 'Not supported on this device';

interface MotionLookMenuItemProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onRecenter: () => void;
  /** Kept by the caller so it survives the menu closing; the switch stays disabled once set. */
  unsupported: boolean;
  onUnsupported: () => void;
  requestPermission?: () => Promise<MotionPermission>;
}

/** A switch that keeps the menu open, plus a Recenter item while it is on. */
export function MotionLookMenuItem({
  enabled,
  onEnabledChange,
  onRecenter,
  unsupported,
  onUnsupported,
  requestPermission = requestMotionPermission,
}: MotionLookMenuItemProps) {
  const [denied, setDenied] = useState(false);
  const [pending, setPending] = useState(false);

  // The permission prompt only shows from inside the tap, so no await precedes the request.
  const toggle = async () => {
    if (enabled) {
      onEnabledChange(false);
      return;
    }
    setPending(true);
    let result: MotionPermission;
    try {
      result = await requestPermission();
    } catch {
      result = 'denied';
    }
    setPending(false);
    setDenied(result === 'denied');
    if (result === 'unsupported') {
      onUnsupported();
    }
    onEnabledChange(result === 'granted');
  };

  return (
    <>
      <RoomMenuChoice>
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={pending || unsupported}
          onChange={toggle}
        />
        Motion look
      </RoomMenuChoice>
      {(unsupported || denied) && (
        <p role="status" className="px-3 pb-1 text-xs text-white/60">
          {unsupported ? UNSUPPORTED_MESSAGE : DENIED_MESSAGE}
        </p>
      )}
      {enabled && <RoomMenuItem onSelect={onRecenter}>Recenter</RoomMenuItem>}
    </>
  );
}
