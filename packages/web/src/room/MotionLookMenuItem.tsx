import { useState } from 'react';
import { requestMotionPermission, type MotionPermission } from '@officexr/world/renderer';
import { RoomMenuChoice, RoomMenuItem } from './RoomMenu';

type Refusal = Exclude<MotionPermission, 'granted'>;

const REFUSAL_MESSAGE: Record<Refusal, string> = {
  denied: 'Motion access denied — enable it in Safari settings',
  unsupported: 'Not supported on this device',
};

interface MotionLookMenuItemProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onRecenter: () => void;
  requestPermission?: () => Promise<MotionPermission>;
}

/** A switch that keeps the menu open, plus a Recenter item while it is on. */
export function MotionLookMenuItem({
  enabled,
  onEnabledChange,
  onRecenter,
  requestPermission = requestMotionPermission,
}: MotionLookMenuItemProps) {
  const [refusal, setRefusal] = useState<Refusal | null>(null);
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
    setRefusal(result === 'granted' ? null : result);
    onEnabledChange(result === 'granted');
  };

  return (
    <>
      <RoomMenuChoice>
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={pending || refusal === 'unsupported'}
          onChange={toggle}
        />
        Motion look
      </RoomMenuChoice>
      {refusal && (
        <p role="status" className="px-3 pb-1 text-xs text-white/60">
          {REFUSAL_MESSAGE[refusal]}
        </p>
      )}
      {enabled && <RoomMenuItem onSelect={onRecenter}>Recenter</RoomMenuItem>}
    </>
  );
}
