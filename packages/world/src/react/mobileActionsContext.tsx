import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { MobileActionRegistry, type MobileAction } from './mobile-actions.ts';

const MobileActionsContext = createContext<MobileActionRegistry | null>(null);

export function MobileActionsProvider(props: { registry: MobileActionRegistry; children?: ReactNode }) {
  return <MobileActionsContext.Provider value={props.registry}>{props.children}</MobileActionsContext.Provider>;
}

/**
 * Adds `actions` to the touch action pad while the caller is mounted; a no-op outside a `PlayView`.
 * Memoise `actions`: a new array re-registers them.
 */
export function useMobileActions(actions: readonly MobileAction[]): void {
  const registry = useContext(MobileActionsContext);
  useEffect(() => registry?.register(actions), [registry, actions]);
}
