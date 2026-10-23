import type { ReactNode } from 'react';
import type { ApiState } from './useApi';

export function Async<T>({
  state,
  loading = <p>Loading…</p>,
  children,
}: {
  state: ApiState<T>;
  loading?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  return state.type === 'loading' ? (
    loading
  ) : state.type === 'error' ? (
    <p role="alert" className="text-red-600">
      {state.message}
    </p>
  ) : (
    children(state.data)
  );
}
