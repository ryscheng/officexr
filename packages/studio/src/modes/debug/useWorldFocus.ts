import { useEffect, useState } from 'react';

/**
 * Tracks whether the in-world 3D canvas currently "has focus" for
 * keyboard input. The model:
 *
 *   - `true` (default) → WASD + arrow keys drive the local
 *     character; the Scene's keyboard handler reads keypresses.
 *   - `false` → keyboard input is released. Any in-flight held keys
 *     are cleared by the consumer so the character stops mid-stride
 *     instead of running indefinitely. The user clicks back on the
 *     canvas (anywhere outside `[data-studio-panel]`) to refocus.
 *
 * Transitions:
 *   - mousedown inside a `[data-studio-panel]` ancestor → `false`.
 *   - mousedown anywhere else → `true`.
 *   - focusin (Tab key navigation) into a panel input → `false`.
 *
 * Why a hook instead of a global module: the indicator in the HUD
 * and the SceneFrame both need to react to focus changes. A React
 * state-bound hook composes cleanly with both — DebugApp passes
 * the boolean through `<Scene worldFocused={...}>` and reads it
 * inline for the indicator.
 */
export function useWorldFocus(): boolean {
  const [focused, setFocused] = useState(true);

  useEffect(() => {
    const isInsidePanel = (el: EventTarget | null): boolean =>
      el instanceof Element && !!el.closest('[data-studio-panel]');

    const onMouseDown = (e: MouseEvent) => {
      // Only left/middle clicks register as a focus change. Right-
      // click typically opens a context menu — don't let it steal
      // world focus by accident.
      if (e.button !== 0 && e.button !== 1) return;
      setFocused(!isInsidePanel(e.target));
    };
    const onFocusIn = (e: FocusEvent) => {
      // Programmatic / Tab focus into a panel input also releases
      // world keyboard control. If focus moves outside any panel
      // (back to body, or a non-panel widget) we DON'T re-focus
      // the world — that requires an explicit click on the canvas,
      // matching the mental model "click world to control".
      if (isInsidePanel(e.target)) setFocused(false);
    };

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, []);

  return focused;
}
