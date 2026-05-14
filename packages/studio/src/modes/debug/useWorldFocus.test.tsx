/**
 * useWorldFocus regressions. The hook drives the focus indicator +
 * the SceneFrame keyboard gate in Debug mode; getting these
 * transitions wrong means the user either can't type into the
 * panel (world steals every keystroke) or can't walk after closing
 * it (panel never releases focus).
 *
 * Tested against jsdom — no Playwright needed because the contract
 * is purely DOM-event-driven.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { render, renderHook, act, cleanup } from '@testing-library/react';
import { useWorldFocus } from './useWorldFocus.ts';

afterEach(() => {
  cleanup();
});

describe('useWorldFocus', () => {
  it('starts focused on the world', () => {
    const { result } = renderHook(() => useWorldFocus());
    expect(result.current).toBe(true);
  });

  it('releases focus when mousedown lands inside [data-studio-panel]', () => {
    const { result } = renderHook(() => useWorldFocus());

    // Mount a fake panel + target element inside it.
    const { container } = render(
      <aside data-studio-panel="true">
        <button id="panel-btn">click me</button>
      </aside>,
    );
    const btn = container.querySelector('#panel-btn')!;

    act(() => {
      btn.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0 }),
      );
    });
    expect(result.current).toBe(false);
  });

  it('reclaims focus when mousedown lands outside any panel', () => {
    const { result } = renderHook(() => useWorldFocus());

    const { container } = render(
      <>
        <aside data-studio-panel="true">
          <button id="panel-btn">in</button>
        </aside>
        <canvas id="world" />
      </>,
    );

    act(() => {
      container
        .querySelector('#panel-btn')!
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    });
    expect(result.current).toBe(false);

    act(() => {
      container
        .querySelector('#world')!
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    });
    expect(result.current).toBe(true);
  });

  it('right-click does not change focus state', () => {
    const { result } = renderHook(() => useWorldFocus());

    const { container } = render(
      <aside data-studio-panel="true">
        <button id="panel-btn">x</button>
      </aside>,
    );

    act(() => {
      container.querySelector('#panel-btn')!.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 2 }),
      );
    });
    // Right-click should NOT release focus — the user is opening
    // a context menu, not switching contexts.
    expect(result.current).toBe(true);
  });

  it('focusin into a panel input releases focus (Tab-key path)', () => {
    const { result } = renderHook(() => useWorldFocus());

    const { container } = render(
      <aside data-studio-panel="true">
        <input id="panel-input" />
      </aside>,
    );

    act(() => {
      container.querySelector('#panel-input')!.dispatchEvent(
        new FocusEvent('focusin', { bubbles: true }),
      );
    });
    expect(result.current).toBe(false);
  });

  it('focusin OUTSIDE any panel does NOT re-focus the world', () => {
    // The hook's contract is: refocusing the world requires an
    // explicit click (Tab away to the body shouldn't undo a
    // previous panel mousedown). This pins that asymmetry.
    const { result } = renderHook(() => useWorldFocus());

    const { container } = render(
      <>
        <aside data-studio-panel="true">
          <button id="panel-btn">x</button>
        </aside>
        <button id="rogue-btn">outside</button>
      </>,
    );

    act(() => {
      container.querySelector('#panel-btn')!.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0 }),
      );
    });
    expect(result.current).toBe(false);

    act(() => {
      container.querySelector('#rogue-btn')!.dispatchEvent(
        new FocusEvent('focusin', { bubbles: true }),
      );
    });
    expect(result.current).toBe(false);
  });
});
