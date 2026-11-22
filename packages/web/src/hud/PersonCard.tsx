import { Bell, Ellipsis, Hand, MessageSquare, Mic, MicOff } from 'lucide-react';
import { Button } from './ui/Button';
import { firstName, personStatus, statusLine } from './peopleStatus';
import { PersonAvatar } from './PersonAvatar';
import type { PresenceRow } from './presenceRows';

export type PersonCardProps = {
  row: PresenceRow;
  now: number;
  offline: boolean;
  muted: boolean;
  pingCoolingDown: boolean;
  compact: boolean;
  onGo: () => void;
  onWave: () => void;
  onToggleMute: () => void;
  onPing: () => void;
  onMessage?: () => void;
  onMore?: () => void;
};

export function PersonCard({ row, now, offline, muted, pingCoolingDown, compact, onGo, onWave, onToggleMute, onPing, onMessage, onMore }: PersonCardProps) {
  const status = personStatus(row, now);
  const statusText = row.type === 'peer' ? row.statusText : null;
  const first = firstName(row.name || row.label);
  const icon = compact ? 'hidden' : 'size-4';
  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-2 pb-1">
      <div className="flex items-start gap-3">
        <PersonAvatar id={row.id} label={row.label} status={status} />
        <div className="min-w-0 flex-1">
          <p className="text-lg leading-6 font-semibold break-words text-hud-text">{row.label}</p>
          <p className="text-sm leading-5 text-hud-text-2">{statusLine(row, now, muted)}</p>
          {statusText && <p className="text-sm leading-5 break-words text-hud-text-2">{statusText}</p>}
        </div>
      </div>
      {offline && (
        <p role="status" className="text-sm leading-5 text-hud-amber-text">
          Offline. Go and Ping are off until you reconnect.
        </p>
      )}
      <Button tone="primary" className="min-h-12 w-full" disabled={offline} onClick={onGo}>
        Go to {first}
      </Button>
      <div className={`grid gap-2 ${compact ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <Button className="min-h-12 px-2!" onClick={onWave}>
          <Hand aria-hidden className={icon} />
          Wave
        </Button>
        <Button className="min-h-12 px-2!" aria-pressed={muted} onClick={onToggleMute}>
          {muted ? <Mic aria-hidden className={icon} /> : <MicOff aria-hidden className={icon} />}
          {muted ? 'Unmute' : 'Mute for me'}
        </Button>
        <Button className="min-h-12 px-2!" disabled={offline || pingCoolingDown} onClick={onPing}>
          <Bell aria-hidden className={icon} />
          {pingCoolingDown ? 'Pinged' : 'Ping'}
        </Button>
        {onMessage && (
          <Button className="min-h-12 px-2!" onClick={onMessage}>
            <MessageSquare aria-hidden className={icon} />
            Message
          </Button>
        )}
        {onMore && (
          <Button className="min-h-12 px-2!" onClick={onMore}>
            <Ellipsis aria-hidden className={icon} />
            More…
          </Button>
        )}
      </div>
      <p role="status" className="sr-only">
        {pingCoolingDown ? `Pinged ${first}` : ''}
      </p>
    </div>
  );
}
