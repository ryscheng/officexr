// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CameraMode } from '../renderer/config.ts';
import { useCameraMode } from './useCameraMode.ts';

afterEach(cleanup);

const altP = () => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', altKey: true })));

describe('useCameraMode', () => {
  it('uncontrolled: starts fixed and Alt+P cycles through the gameplay modes', () => {
    const { result } = renderHook(() => useCameraMode());
    expect(result.current).toBe('fixed');
    for (const mode of ['top-down', 'first-person', 'third-person', 'fixed']) {
      altP();
      expect(result.current).toBe(mode);
    }
  });

  it('ignores P without Alt', () => {
    const { result } = renderHook(() => useCameraMode());
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' })));
    expect(result.current).toBe('fixed');
  });

  it('controlled: Alt+P reports the next mode and leaves the value to the caller', () => {
    const onChange = vi.fn();
    const { result, rerender } = renderHook(({ value }: { value: CameraMode }) => useCameraMode({ value, onChange }), {
      initialProps: { value: 'third-person' },
    });
    altP();
    expect(onChange).toHaveBeenCalledWith('fixed');
    expect(result.current).toBe('third-person');
    rerender({ value: 'fixed' });
    altP();
    expect(onChange).toHaveBeenLastCalledWith('top-down');
    rerender({ value: 'top-down' });
    altP();
    expect(onChange).toHaveBeenLastCalledWith('first-person');
  });
});
