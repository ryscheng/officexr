// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { resetJoystickModeForTest, useJoystickMode } from './joystickMode';

afterEach(() => {
  cleanup();
  resetJoystickModeForTest();
  localStorage.clear();
});

describe('useJoystickMode', () => {
  it('defaults to floating', () => {
    expect(renderHook(() => useJoystickMode()).result.current[0]).toBe('floating');
  });

  it('keeps the choice in storage and tells every user of the hook', () => {
    const a = renderHook(() => useJoystickMode());
    const b = renderHook(() => useJoystickMode());
    act(() => a.result.current[1]('fixed'));
    expect(b.result.current[0]).toBe('fixed');
    expect(localStorage.getItem('officexr:hud:joystick')).toBe('fixed');
  });

  it('still works for the session when storage throws', () => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
    try {
      const hook = renderHook(() => useJoystickMode());
      act(() => hook.result.current[1]('fixed'));
      expect(hook.result.current[0]).toBe('fixed');
    } finally {
      Storage.prototype.setItem = real;
    }
  });
});
