import { useState } from 'react';
import { requestMotionPermission, type MotionPermission } from '@officexr/world/renderer';
import { RoomMenuItem } from './RoomMenu';

const REFUSAL: Record<Exclude<MotionPermission, 'granted'>, string> = {
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
  const [refusal, setRefusal] = useState<string | null>(null);

  // The permission prompt only shows from inside the tap, so no await precedes the request.
  const toggle = async () => {
    if (enabled) {
      onEnabledChange(false);
      return;
    }
    const result = await requestPermission();
    setRefusal(result === 'granted' ? null : REFUSAL[result]);
    onEnabledChange(result === 'granted');
  };

  return (
    <>
      <label className="flex w-full cursor-pointer items-center gap-2 rounded px-3 py-3 hover:bg-white/10">
        <input type="checkbox" role="switch" checked={enabled} onChange={toggle} />
        Motion look
      </label>
      {refusal && <p className="px-3 pb-1 text-xs text-white/60">{refusal}</p>}
      {enabled && <RoomMenuItem onSelect={onRecenter}>Recenter</RoomMenuItem>}
    </>
  );
}
