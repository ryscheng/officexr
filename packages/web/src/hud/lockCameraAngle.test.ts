// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cameraAngleLocked,
  forgetLegacyJoystickChoice,
  resetLockCameraAngleForTest,
  useLockCameraAngle,
} from './lockCameraAngle';

afterEach(() => {
  cleanup();
  resetLockCameraAngleForTest();
  localStorage.clear();
});

describe('cameraAngleLocked', () => {
  const off = { overhead: false, motionLook: false, userLock: false };

  it('is unlocked when no source holds it', () => {
    expect(cameraAngleLocked(off)).toBe(false);
  });

  it.each(['overhead', 'motionLook', 'userLock'] as const)('is locked by %s alone', (source) => {
    expect(cameraAngleLocked({ ...off, [source]: true })).toBe(true);
  });
});

describe('useLockCameraAngle', () => {
  it('defaults to unlocked', () => {
    expect(renderHook(() => useLockCameraAngle()).result.current[0]).toBe(false);
  });

  it('reads a stored choice on first use', () => {
    localStorage.setItem('officexr:hud:lock-camera-angle', 'on');
    expect(renderHook(() => useLockCameraAngle()).result.current[0]).toBe(true);
  });

  it('keeps the choice in storage and tells every user of the hook', () => {
    const a = renderHook(() => useLockCameraAngle());
    const b = renderHook(() => useLockCameraAngle());
    act(() => a.result.current[1](true));
    expect(b.result.current[0]).toBe(true);
    expect(localStorage.getItem('officexr:hud:lock-camera-angle')).toBe('on');
    act(() => a.result.current[1](false));
    expect(b.result.current[0]).toBe(false);
    expect(localStorage.getItem('officexr:hud:lock-camera-angle')).toBe('off');
  });

  it('still works for the session when storage throws', () => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
    try {
      const hook = renderHook(() => useLockCameraAngle());
      act(() => hook.result.current[1](true));
      expect(hook.result.current[0]).toBe(true);
    } finally {
      Storage.prototype.setItem = real;
    }
  });

  it('reads as unlocked when storage throws on read', () => {
    const real = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
    try {
      expect(renderHook(() => useLockCameraAngle()).result.current[0]).toBe(false);
    } finally {
      Storage.prototype.getItem = real;
    }
  });
});

describe('forgetLegacyJoystickChoice', () => {
  it('removes the old joystick key', () => {
    localStorage.setItem('officexr:hud:joystick', 'fixed');
    forgetLegacyJoystickChoice();
    expect(localStorage.getItem('officexr:hud:joystick')).toBeNull();
  });

  it('does not throw when storage is blocked', () => {
    const real = Storage.prototype.removeItem;
    Storage.prototype.removeItem = () => {
      throw new Error('blocked');
    };
    try {
      expect(() => forgetLegacyJoystickChoice()).not.toThrow();
    } finally {
      Storage.prototype.removeItem = real;
    }
  });
});
