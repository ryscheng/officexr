// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createViewYaw, useViewYaw, ViewYawProvider } from './viewYaw.tsx';

afterEach(cleanup);

const deg = (d: number) => (d * Math.PI) / 180;

describe('createViewYaw', () => {
  it('notifies only when the yaw moves at least 1° from the last published value', () => {
    const viewYaw = createViewYaw();
    const cb = vi.fn();
    viewYaw.subscribe(cb);
    viewYaw.set(deg(0.5));
    expect(cb).not.toHaveBeenCalled();
    expect(viewYaw.get()).toBe(0);
    viewYaw.set(deg(1));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(viewYaw.get()).toBe(deg(1));
    viewYaw.set(deg(1.9));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('measures the gate across the ±π wrap', () => {
    const viewYaw = createViewYaw();
    viewYaw.set(Math.PI - deg(0.2));
    viewYaw.set(-Math.PI + deg(0.2));
    expect(viewYaw.get()).toBe(Math.PI - deg(0.2));
  });

  it('stops notifying after unsubscribe', () => {
    const viewYaw = createViewYaw();
    const cb = vi.fn();
    const unsubscribe = viewYaw.subscribe(cb);
    unsubscribe();
    viewYaw.set(deg(10));
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('useViewYaw', () => {
  it('re-renders on a change of 1° or more, not on smaller ones', () => {
    const viewYaw = createViewYaw();
    let renders = 0;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ViewYawProvider viewYaw={viewYaw}>{children}</ViewYawProvider>
    );
    const { result } = renderHook(
      () => {
        renders += 1;
        return useViewYaw();
      },
      { wrapper },
    );
    const initial = renders;
    act(() => viewYaw.set(deg(0.4)));
    expect(renders).toBe(initial);
    act(() => viewYaw.set(deg(2)));
    expect(renders).toBe(initial + 1);
    expect(result.current).toBe(deg(2));
  });

  it('throws outside a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useViewYaw())).toThrow(/ViewYawProvider/);
  });
});
