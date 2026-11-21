import { useState } from 'react';
import { KeybindsTab } from '../../room/KeybindsTab';
import { clearHintFlags } from '../hintFlags';
import { Button } from '../ui/Button';

const MOVES = [
  ['Move', 'Drag on the left side of the screen.'],
  ['Look around', 'Drag on the right side of the screen.'],
  ['Wave or sit', 'Tap the button that appears near your avatar.'],
] as const;

function HowToMove() {
  return (
    <dl className="divide-y divide-hud-separator overflow-hidden rounded-xl bg-hud-surface shadow-[0_0_0_0.5px_var(--color-hud-hairline)]">
      {MOVES.map(([title, text]) => (
        <div key={title} className="px-4 py-3">
          <dt className="text-base font-semibold">{title}</dt>
          <dd className="text-sm text-hud-text-2">{text}</dd>
        </div>
      ))}
    </dl>
  );
}

export function HelpPage({ coarse }: { coarse: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <>
      <h3 className="px-1 text-sm font-semibold text-hud-text-2">{coarse ? 'How to move' : 'Keyboard shortcuts'}</h3>
      {coarse ? <HowToMove /> : <KeybindsTab />}
      {!coarse && <p className="px-1 text-sm text-hud-text-2">Hold right mouse button or drag to look around.</p>}
      <Button
        className="min-h-12 w-full"
        onClick={() => {
          clearHintFlags();
          setShown(true);
        }}
      >
        Show hints again
      </Button>
      <p role="status" className="px-1 text-sm text-hud-text-2 empty:hidden">
        {shown ? 'Hints will show again.' : ''}
      </p>
      <p className="px-1 text-sm text-hud-text-2">Questions or problems? Tell the person who invited you.</p>
    </>
  );
}
