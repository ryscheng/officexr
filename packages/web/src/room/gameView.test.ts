// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  angleHeld,
  cameraModeOf,
  forgetLegacyJoystickChoice,
  storedOpenView,
  storeOpenView,
  viewOfCameraMode,
  VIEW_GROUPS,
  type GameView,
} from './gameView';

afterEach(() => localStorage.clear());

describe('angleHeld', () => {
  it.each<GameView>(['map', 'birds-eye', 'angled'])('holds the angle in %s', (view) => {
    expect(angleHeld(view, false)).toBe(true);
  });

  it.each<GameView>(['free-look', 'first-person'])('leaves the angle free in %s', (view) => {
    expect(angleHeld(view, false)).toBe(false);
  });

  it.each<GameView>(['map', 'birds-eye', 'angled', 'free-look', 'first-person'])('holds the angle in %s while motion look is on', (view) => {
    expect(angleHeld(view, true)).toBe(true);
  });
});

describe('views', () => {
  it('lists the options in order under their groups', () => {
    expect(VIEW_GROUPS.map((g) => [g.heading, g.options.map((o) => o.label)])).toEqual([
      ['2D', ['Map (2D)']],
      ['3D', ["Bird's-eye", 'Angled', 'Free look', 'First person']],
    ]);
  });

  it('maps each view to a renderer camera mode', () => {
    expect(['map', 'birds-eye', 'angled', 'free-look', 'first-person'].map((v) => cameraModeOf(v as GameView))).toEqual([
      'fixed',
      'fixed',
      'fixed',
      'third-person',
      'first-person',
    ]);
  });

  it('keeps bird\'s-eye when the fixed mode is chosen again, else picks the angled view', () => {
    expect(viewOfCameraMode('fixed', 'birds-eye')).toBe('birds-eye');
    expect(viewOfCameraMode('fixed', 'free-look')).toBe('angled');
    expect(viewOfCameraMode('third-person', 'angled')).toBe('free-look');
    expect(viewOfCameraMode('first-person', 'angled')).toBe('first-person');
  });
});

describe('stored 3D view', () => {
  it('defaults to angled, as the camera did before the choice was stored', () => {
    expect(storedOpenView()).toBe('angled');
  });

  it('remembers a choice and ignores junk', () => {
    storeOpenView('free-look');
    expect(storedOpenView()).toBe('free-look');
    localStorage.setItem('officexr:gameView', 'sideways');
    expect(storedOpenView()).toBe('angled');
  });

  it('falls back when storage throws', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    expect(storedOpenView({ getItem: boom })).toBe('angled');
    expect(() => storeOpenView('angled', { setItem: boom })).not.toThrow();
    expect(() => forgetLegacyJoystickChoice({ removeItem: boom })).not.toThrow();
  });

  it('removes the old joystick key', () => {
    localStorage.setItem('officexr:hud:joystick', 'fixed');
    forgetLegacyJoystickChoice();
    expect(localStorage.getItem('officexr:hud:joystick')).toBeNull();
  });
});
