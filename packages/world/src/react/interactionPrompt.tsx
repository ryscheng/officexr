import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { ActionInput } from '../input/action-input.ts';
import {
  INTERACTION_PROVIDERS,
  NO_PROMPT,
  type InteractionKind,
  type InteractionPrompt,
  type InteractionStore,
} from '../input/interaction.ts';

export interface InteractionSource {
  store: InteractionStore;
  run(kind: InteractionKind): void;
}

export function createInteractionSource(store: InteractionStore, input: ActionInput): InteractionSource {
  return {
    store,
    run(kind) {
      const { action } = INTERACTION_PROVIDERS[kind];
      input.press(action);
      input.release(action);
    },
  };
}

const InteractionContext = createContext<InteractionSource | null>(null);

export function InteractionProvider(props: { source: InteractionSource; children?: ReactNode }) {
  return <InteractionContext.Provider value={props.source}>{props.children}</InteractionContext.Provider>;
}

const noSubscribe = () => () => {};

export interface InteractionPromptView extends InteractionPrompt {
  run(kind: InteractionKind): void;
}

const NO_RUN = () => {};

export function useInteractionPrompt(): InteractionPromptView {
  const source = useContext(InteractionContext);
  const prompt = useSyncExternalStore(source ? source.store.subscribe : noSubscribe, source ? source.store.get : () => NO_PROMPT);
  return { ...prompt, run: source?.run ?? NO_RUN };
}

export function useSuppressInteractionPrompt(suppressed: boolean): void {
  const source = useContext(InteractionContext);
  useEffect(() => {
    source?.store.setSuppressed(suppressed);
    return () => source?.store.setSuppressed(false);
  }, [source, suppressed]);
}
