import { isPlaceableKind, PLACEABLE_KINDS, rotateYaw, type PlacedProp } from '@officexr/sdk';
import { PLACE_ERROR_TEXT, type PlacementHost } from '../motion/place-mode.ts';
import { isTypingTarget } from '../react/useWorldFocus.ts';

const HANDLED = new Set(['enter', 'r', 't', 'g', 'delete', 'backspace', 'tab']);

/**
 * The keydown handler of build mode. It claims its keys (preventDefault, then stops the event), so a
 * shortcut elsewhere on the same key, such as the emote picker's R, never also fires while building.
 */
export function createPlaceKeyHandler(host: PlacementHost, placed: () => readonly PlacedProp[]) {
  const run = async (op: Parameters<PlacementHost['send']>[0]) => {
    const result = await host.send(op);
    host.mode.setNotice(result.ok ? null : PLACE_ERROR_TEXT[result.error]);
  };
  const place = () => {
    const m = host.mode.get();
    if (m.ghost?.valid) void run({ op: 'place', kindId: m.kindId, position: m.ghost.position, yawDeg: m.yawDeg });
  };
  const target = () => {
    const id = host.mode.get().ghost?.targetId;
    return id ? placed().find((p) => p.id === id) : undefined;
  };
  return {
    place,
    onKeyDown(e: KeyboardEvent) {
      if (!host.mode.get().open || isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (!HANDLED.has(key)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      const t = target();
      if (key === 'enter') place();
      else if (key === 'r') host.mode.rotate();
      else if (key === 'tab') {
        const kinds = PLACEABLE_KINDS.map((k) => k.kindId);
        host.mode.selectKind(kinds[(kinds.indexOf(host.mode.get().kindId) + 1) % kinds.length]);
      } else if (!t) return;
      else if (key === 't') void run({ op: 'update', id: t.id, kindId: t.kindId, position: t.position, yawDeg: rotateYaw(t.yawDeg) });
      else if (key === 'g') {
        void run({ op: 'remove', id: t.id });
        if (isPlaceableKind(t.kindId)) {
          host.mode.selectKind(t.kindId);
          host.mode.setYaw(t.yawDeg);
        }
      } else void run({ op: 'remove', id: t.id });
    },
  };
}
