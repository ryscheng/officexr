import { useSyncExternalStore } from 'react';
import { Html } from '@react-three/drei';
import type { InteractionPrompt, InteractionStore } from '../input/interaction.ts';
import { useCoarsePointer } from '../react/useCoarsePointer.ts';
import './InteractionPromptAnchor.css';

const RAISE_M = 0.1;

export function InteractionPromptAnchor({ interactions }: { interactions: InteractionStore }) {
  const prompt = useSyncExternalStore(interactions.subscribe, interactions.get);
  const coarse = useCoarsePointer();
  const { anchor } = prompt;
  if (coarse || anchor === null) {
    return null;
  }
  return (
    <Html center position={[anchor.x, anchor.y + RAISE_M, anchor.z]} zIndexRange={[1, 0]} pointerEvents="none">
      <InteractionPill options={prompt.options} />
    </Html>
  );
}

export function InteractionPill({ options }: Pick<InteractionPrompt, 'options'>) {
  return (
    <div className="interaction-pill" role="status" aria-label="Interactions">
      {options.map((o) => (
        <span key={o.kind} className="interaction-pill-option">
          <kbd className="interaction-pill-key">{o.key}</kbd>
          {o.label}
        </span>
      ))}
    </div>
  );
}
