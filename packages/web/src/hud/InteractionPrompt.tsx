import { useEffect, useState } from 'react';
import { focusWorld, isTypingTarget, useCoarsePointer, useInteractionPrompt, useSuppressInteractionPrompt } from '@officexr/world/top-down';
import { Button } from './ui/Button';
import { Keycap } from './ui/Keycap';
import { Panel } from './ui/Panel';

const typingNow = () => isTypingTarget(document.activeElement);

/** Whether a text field has focus, so the prompt gives way to the keyboard. */
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

/** Hides the world's prompt and this one while chat is being typed or a sheet, the map or build mode is open. */
export function SuppressInteractionPrompt({ covered }: { covered: boolean }) {
  const typing = useTyping();
  useSuppressInteractionPrompt(covered || typing);
  return null;
}

/**
 * Touch: the options in reach as tap buttons in the bottom-right action area.
 * Desktop: the world floats the options above their object; only options with no object, such as Get off, show here.
 */
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
