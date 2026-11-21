import { Keycap } from '../ui/Keycap';

const HINTS = [
  ['Tab', 'next prop'],
  ['R', 'rotate'],
  ['Enter', 'place'],
  ['B', 'close'],
] as const;

export function BuildKeyHints() {
  return (
    <ul aria-label="Build keys" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-hud-text-2">
      {HINTS.map(([key, action]) => (
        <li key={key} className="flex items-center gap-1.5">
          <Keycap>{key}</Keycap>
          {action}
        </li>
      ))}
    </ul>
  );
}
