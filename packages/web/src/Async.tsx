import type { ReactNode } from 'react';
import type { ApiState } from './useApi';
import { InlineAlert } from './hud/ui/InlineAlert';
import { Spinner } from './page/PageShell';

export function Async<T>({
  state,
  loading = <Spinner label="Loading…" />,
  error = (message) => <InlineAlert>{message}</InlineAlert>,
  children,
}: {
  state: ApiState<T>;
  loading?: ReactNode;
  /** Renders the failure; defaults to an inline alert. */
  error?: (message: string, status?: number) => ReactNode;
  children: (data: T) => ReactNode;
}) {
  return state.type === 'loading' ? (
    loading
  ) : state.type === 'error' ? (
    error(state.message, state.status)
  ) : (
    children(state.data)
  );
}
