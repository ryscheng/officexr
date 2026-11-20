import { createContext, useContext } from 'react';
import type { SfxEngine } from './engine.ts';

const SfxContext = createContext<SfxEngine | null>(null);

/** The host app provides the engine; without one (the studio) the scene plays no sound effects. */
export const SfxProvider = SfxContext.Provider;

export const useSfx = (): SfxEngine | null => useContext(SfxContext);
