import type { Bus, PingIntent, PlayerId, Store } from '@officexr/sdk';
import { senderName } from './senderName';

export interface SocialToast {
  id: string;
  kind: PingIntent;
  fromId: PlayerId;
  name: string;
}

export class SocialToastQueue {
  private snapshot: readonly SocialToast[] = [];
  private readonly listeners = new Set<() => void>();
  private nextId = 0;

  add(kind: PingIntent, fromId: PlayerId, name: string): void {
    const rest = this.snapshot.filter((t) => !(t.kind === kind && t.fromId === fromId));
    this.set([...rest, { id: String(this.nextId++), kind, fromId, name }]);
  }

  dismiss(id: string): void {
    this.set(this.snapshot.filter((t) => t.id !== id));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): readonly SocialToast[] => this.snapshot;

  private set(next: readonly SocialToast[]): void {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }
}

export function connectSocialToasts(bus: Bus, store: Store, queue: SocialToastQueue): () => void {
  return bus.on('ping:received', ({ fromId, intent }) => {
    queue.add(intent ?? 'ping', fromId, senderName(store, fromId));
  });
}
