import type { ReactNode } from 'react';
import type { ApiState } from './useApi';

export function Async<T>({ state, children }: { state: ApiState<T>; children: (data: T) => ReactNode }) {
  return state.type === 'loading' ? (
    <p>Loading…</p>
  ) : state.type === 'error' ? (
    <p role="alert" className="text-red-600">
      {state.message}
    </p>
  ) : (
    children(state.data)
  );
}
