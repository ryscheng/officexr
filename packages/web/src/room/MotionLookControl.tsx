import { useState } from 'react';
import { requestMotionPermission, type MotionPermission } from '@officexr/world/renderer';
import { Switch } from '../hud/ui/Switch';

const DENIED_MESSAGE = 'Motion access denied — enable it in Safari settings';
const UNSUPPORTED_MESSAGE = 'Not supported on this device';

interface MotionLookControlProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onRecenter: () => void;
  /** Kept by the caller so it survives Settings closing; the switch stays disabled once set. */
  unsupported: boolean;
  onUnsupported: () => void;
  requestPermission?: () => Promise<MotionPermission>;
}

export function MotionLookControl({
  enabled,
  onEnabledChange,
  onRecenter,
  unsupported,
  onUnsupported,
  requestPermission = requestMotionPermission,
}: MotionLookControlProps) {
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
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {enabled && (
          <button
            type="button"
            onClick={onRecenter}
            className="rounded-hud-control border-2 border-hud-edge bg-hud-inset px-3 py-1 hover:bg-hud-edge"
          >
            Recenter
          </button>
        )}
        <Switch aria-label="Motion look" checked={enabled} disabled={pending || unsupported} onCheckedChange={toggle} />
      </div>
      {(unsupported || denied) && (
        <p role="status" className="text-xs text-hud-text-2">
          {unsupported ? UNSUPPORTED_MESSAGE : DENIED_MESSAGE}
        </p>
      )}
    </div>
  );
}
