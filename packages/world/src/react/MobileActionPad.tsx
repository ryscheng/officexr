import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ActionInput } from '../input/action-input.ts';
import type { ActionContextStore } from '../input/action-context.ts';
import {
  PAD_SLOTS,
  resolve,
  visibleActions,
  type MobileAction,
  type MobileActionContext,
  type MobileActionRegistry,
} from './mobile-actions.ts';
import { useModalOpen } from './useModalOpen.ts';

const INSET = 12;
const HAPTIC_MS = 10;

const insetCalc = (offset: number, edge: 'right' | 'bottom') =>
  `calc(${offset}px + max(${INSET}px, env(safe-area-inset-${edge}, 0px)))`;

function haptic(): void {
  try {
    navigator.vibrate?.(HAPTIC_MS);
  } catch {
    // Vibration is optional and some browsers throw without a user gesture.
  }
}

function ActionButton({ action, getContext }: { action: MobileAction; getContext: () => MobileActionContext }) {
  const pointer = useRef<number | null>(null);
  const [pressed, setPressed] = useState(false);
  const ctx = getContext();
  const slot = PAD_SLOTS[action.slot]!;
  const angle = (slot.angleDeg * Math.PI) / 180;
  const centre = { right: PAD_SLOTS[0]!.size / 2 + slot.radius * Math.cos(angle), bottom: PAD_SLOTS[0]!.size / 2 + slot.radius * Math.sin(angle) };
  const lit = pressed || (action.active?.(ctx) ?? false);

  const onRelease = useRef(action.onRelease);
  onRelease.current = action.onRelease;
  const getContextRef = useRef(getContext);
  getContextRef.current = getContext;
  useEffect(
    () => () => {
      if (pointer.current !== null) {
        pointer.current = null;
        onRelease.current?.(getContextRef.current());
      }
    },
    [],
  );

  const end = (e: React.PointerEvent) => {
    if (e.pointerId !== pointer.current) {
      return;
    }
    pointer.current = null;
    setPressed(false);
    action.onRelease?.(getContext());
  };

  return (
    <button
      type="button"
      aria-label={resolve(action.label, ctx)}
      aria-pressed={action.active ? lit : undefined}
      tabIndex={-1}
      data-mobile-action={action.id}
      onPointerDown={(e) => {
        if (pointer.current !== null) {
          return;
        }
        e.preventDefault();
        pointer.current = e.pointerId;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setPressed(true);
        haptic();
        action.onPress(getContext());
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onContextMenu={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: 'absolute',
        right: insetCalc(centre.right - slot.size / 2, 'right'),
        bottom: insetCalc(centre.bottom - slot.size / 2, 'bottom'),
        width: slot.size,
        height: slot.size,
        borderRadius: '50%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        padding: 0,
        boxSizing: 'border-box',
        font: '600 10px/1 system-ui, sans-serif',
        color: lit ? 'var(--color-hud-on-accent, #fff)' : 'var(--color-hud-text, #fff)',
        background: lit ? 'var(--color-hud-accent, rgba(10, 132, 255, 0.85))' : 'var(--color-hud-panel, rgba(40, 40, 48, 0.45))',
        border: '1px solid rgba(255, 255, 255, 0.45)',
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.25)',
        backdropFilter: 'blur(14px) saturate(180%)',
        WebkitBackdropFilter: 'blur(14px) saturate(180%)',
        transform: pressed ? 'scale(0.92)' : 'none',
        transition: 'transform 80ms, background-color 80ms',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        WebkitTapHighlightColor: 'transparent',
        pointerEvents: 'auto',
        cursor: 'pointer',
      }}
    >
      <span style={{ pointerEvents: 'none', display: 'flex' }}>{resolve(action.icon, ctx)}</span>
      {slot.size < PAD_SLOTS[0]!.size && <span style={{ pointerEvents: 'none' }}>{resolve(action.label, ctx)}</span>}
    </button>
  );
}

/**
 * The touch action pad: a thumb cluster in the bottom-right corner. Each button owns its own pointer, so
 * it works while the joystick is held, and it sits on top of the canvas so a touch on it never starts a
 * camera drag. Hidden while a dialog or text field is active.
 */
export function MobileActionPad(props: {
  registry: MobileActionRegistry;
  input: ActionInput;
  context: ActionContextStore;
}) {
  const { registry, input, context } = props;
  const actions = useSyncExternalStore(registry.subscribe, registry.list);
  const interactContext = useSyncExternalStore(context.subscribe, context.get);
  const blocked = useModalOpen();
  const ctx = useMemo<MobileActionContext>(() => ({ ...interactContext, input }), [interactContext, input]);
  const getContext = useCallback((): MobileActionContext => ({ ...context.get(), input }), [context, input]);

  useEffect(() => {
    if (blocked) {
      input.releaseAll();
    }
    return () => input.releaseAll();
  }, [blocked, input]);

  useEffect(() => {
    const releaseAll = () => input.releaseAll();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') releaseAll();
    };
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [input]);

  if (blocked) {
    return null;
  }
  return (
    <div data-mobile-action-pad style={{ position: 'absolute', inset: 0, zIndex: 15, pointerEvents: 'none' }}>
      {visibleActions(actions, ctx).map((action) => (
        <ActionButton key={action.id} action={action} getContext={getContext} />
      ))}
    </div>
  );
}
