import { useId } from 'react';
import type { PlayerId } from '@officexr/sdk';
import { parseTarget, targetValue, type ChatTarget } from './chatScope';
import { useSocial } from './SocialProvider';

export function ScopeLine({ target, people, onChange }: { target: ChatTarget; people: Array<{ id: PlayerId; name: string }>; onChange: (target: ChatTarget) => void }) {
  const { caps, officeName } = useSocial();
  const id = useId();
  return (
    <div className="flex shrink-0 items-center gap-2 text-sm leading-5 text-hud-text-2">
      <label htmlFor={id}>To</label>
      <select
        id={id}
        value={targetValue(target)}
        onChange={(e) => onChange(parseTarget(e.target.value))}
        className="min-w-0 flex-1 rounded-hud-control bg-hud-inset px-2 py-1 text-hud-text outline-none focus-visible:outline-2 focus-visible:outline-hud-accent pointer-coarse:min-h-12 pointer-coarse:text-base"
      >
        <option value="everyone">{officeName ? `Everyone in ${officeName}` : 'Everyone'}</option>
        {caps.nearbyChat && <option value="nearby">People nearby</option>}
        {caps.directChat && people.length > 0 && (
          <optgroup label="One person">
            {people.map((person) => (
              <option key={person.id} value={`direct:${person.id}`}>
                {person.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}
