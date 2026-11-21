import { Keycap } from '../ui/Keycap';
import { Panel } from '../ui/Panel';

const HINTS = [
  ['Tab', 'next prop'],
  ['R', 'rotate'],
  ['Enter', 'place'],
  ['B', 'close'],
] as const;

export function BuildKeyHints() {
  return (
    <Panel className="px-3 py-2">
      <ul aria-label="Build keys" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-hud-text-2">
        {HINTS.map(([key, action]) => (
          <li key={key} className="flex items-center gap-1.5">
            <Keycap>{key}</Keycap>
            {action}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
