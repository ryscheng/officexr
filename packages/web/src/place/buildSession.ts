import type { PlaceableKindId, PlacedProp, PropOp } from '@officexr/sdk';
import { PLACE_ERROR_TEXT, type PlaceModeStore, type PlacementHost } from '@officexr/world/motion';
import type { RequestPropOp } from './requestPropOp';

export interface PlacedNote {
  seq: number;
  kindId: PlaceableKindId;
  position: [number, number, number];
  yawDeg: number;
}

export interface BuildSession {
  host: PlacementHost;
  last(): PlacedNote | null;
  subscribe(listener: () => void): () => void;
  undo(): Promise<void>;
  dismiss(): void;
}

export function createBuildSession(mode: PlaceModeStore, send: RequestPropOp, placed: () => readonly PlacedProp[]): BuildSession {
  let last: PlacedNote | null = null;
  let seq = 0;
  const listeners = new Set<() => void>();
  const set = (next: PlacedNote | null) => {
    last = next;
    listeners.forEach((l) => l());
  };
  const sendAndNote: PlacementHost['send'] = async (op: PropOp) => {
    const result = await send(op);
    if (result.ok && op.op === 'place') {
      set({ seq: ++seq, kindId: op.kindId, position: op.position, yawDeg: op.yawDeg });
    }
    return result;
  };
  return {
    host: { mode, send: sendAndNote },
    last: () => last,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async undo() {
      const note = last;
      if (!note) {
        return;
      }
      set(null);
      const prop = placed().findLast((p) => p.kindId === note.kindId && p.yawDeg === note.yawDeg && p.position.every((v, i) => v === note.position[i]));
      if (!prop) {
        return;
      }
      const result = await send({ op: 'remove', id: prop.id });
      mode.setNotice(result.ok ? null : PLACE_ERROR_TEXT[result.error]);
    },
    dismiss: () => set(null),
  };
}
