import type { GameEvent, GameEventKind } from './types.ts';

type Handler<K extends GameEventKind> = (event: Extract<GameEvent, { kind: K }>) => void;

export interface Bus {
  emit(event: GameEvent): void;
  on<K extends GameEventKind>(kind: K, handler: Handler<K>): () => void;
}

export function createBus(): Bus {
  const handlers = new Map<GameEventKind, Array<(event: GameEvent) => void>>();

  return {
    emit(event) {
      const list = handlers.get(event.kind);
      if (!list) return;
      // Iterate over a snapshot so off() inside a handler doesn't shift indices.
      for (const handler of list.slice()) {
        try {
          handler(event);
        } catch (err) {
          console.error(`[bus] handler for ${event.kind} threw:`, err);
        }
      }
    },
    on(kind, handler) {
      let list = handlers.get(kind);
      if (!list) {
        list = [];
        handlers.set(kind, list);
      }
      list.push(handler as (event: GameEvent) => void);
      return () => {
        const current = handlers.get(kind);
        if (!current) return;
        const idx = current.indexOf(handler as (event: GameEvent) => void);
        if (idx >= 0) current.splice(idx, 1);
      };
    },
  };
}
