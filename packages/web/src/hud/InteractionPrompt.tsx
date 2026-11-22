import { useEffect, useState } from 'react';
import { focusWorld, isTypingTarget, useCoarsePointer, useInteractionPrompt, useSuppressInteractionPrompt } from '@officexr/world/top-down';
import { Button } from './ui/Button';
import { Keycap } from './ui/Keycap';
import { Panel } from './ui/Panel';

const typingNow = () => isTypingTarget(document.activeElement);

export function useTyping(): boolean {
  const [typing, setTyping] = useState(typingNow);
  useEffect(() => {
    const update = () => setTyping(typingNow());
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, []);
  return typing;
}

export function SuppressInteractionPrompt({ covered }: { covered: boolean }) {
  const typing = useTyping();
  useSuppressInteractionPrompt(covered || typing);
  return null;
}

// Desktop shows an option in the world above its object; only one with no object, such as Get off, shows here.
export function InteractionPrompt() {
  const { options, anchor, run } = useInteractionPrompt();
  const coarse = useCoarsePointer();
  if (options.length === 0 || (!coarse && anchor !== null)) {
    return null;
  }
  if (!coarse) {
    return (
      <Panel role="status" aria-label="Interactions" className="pointer-events-none flex items-center gap-3 px-3 py-1.5 text-sm font-semibold">
        {options.map((o) => (
          <span key={o.kind} className="flex items-center gap-1.5">
            <Keycap>{o.key}</Keycap>
            {o.label}
          </span>
        ))}
      </Panel>
    );
  }
  return (
    <div role="group" aria-label="Interactions" className="pointer-events-none flex flex-col items-end gap-2">
      {[...options].reverse().map((o, i, all) => (
        <Button
          key={o.kind}
          size="md"
          tone={i === all.length - 1 ? 'primary' : 'neutral'}
          className="pointer-events-auto min-w-24 motion-safe:animate-hud-in"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            run(o.kind);
            focusWorld();
          }}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}
