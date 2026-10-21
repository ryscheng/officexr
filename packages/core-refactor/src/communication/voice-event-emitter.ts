import type { VoiceAdapterEventName, VoiceAdapterEvents } from './types.ts';

type Handler<K extends VoiceAdapterEventName> = (payload: VoiceAdapterEvents[K]) => void;

/** The `on` half of {@link VoiceAdapter}; a throwing handler is logged under `label` and doesn't stop the rest. */
export class VoiceEventEmitter {
  private handlers = new Map<VoiceAdapterEventName, Set<Handler<never>>>();

  constructor(private readonly label: string) {}

  on<K extends VoiceAdapterEventName>(name: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  emit<K extends VoiceAdapterEventName>(name: K, payload: VoiceAdapterEvents[K]): void {
    for (const handler of [...(this.handlers.get(name) ?? [])]) {
      try {
        (handler as Handler<K>)(payload);
      } catch (err) {
        console.error(`[${this.label}] handler threw:`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
