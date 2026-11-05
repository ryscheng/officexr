import { loginOf, type Bus, type PlayerId, type Store } from '@officexr/sdk';

export const MAX_INBOX_ENTRIES = 10;

export interface PingInboxEntry {
  id: string;
  fromId: PlayerId;
  name: string;
  /** Wall-clock ms, unlike the session clock the bus event carries. */
  receivedAt: number;
}

export interface PingInboxSnapshot {
  /** Newest first. */
  entries: readonly PingInboxEntry[];
  unread: number;
}

/** Pings received this session; a new snapshot object is published on every change. */
export class PingInbox {
  private snapshot: PingInboxSnapshot = { entries: [], unread: 0 };
  private readonly listeners = new Set<() => void>();
  private nextId = 0;

  constructor(readonly wallClock: () => number = Date.now) {}

  add(fromId: PlayerId, name: string): void {
    const entry = { id: String(this.nextId++), fromId, name, receivedAt: this.wallClock() };
    this.set({
      entries: [entry, ...this.snapshot.entries].slice(0, MAX_INBOX_ENTRIES),
      unread: Math.min(this.snapshot.unread + 1, MAX_INBOX_ENTRIES),
    });
  }

  markAllRead(): void {
    if (this.snapshot.unread > 0) {
      this.set({ ...this.snapshot, unread: 0 });
    }
  }

  clear(): void {
    this.set({ entries: [], unread: 0 });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PingInboxSnapshot => this.snapshot;

  private set(next: PingInboxSnapshot): void {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }
}

/** Feeds `ping:received` into the inbox, naming the sender at receipt. Returns the unsubscribe. */
export function connectPingInbox(bus: Bus, store: Store, inbox: PingInbox): () => void {
  return bus.on('ping:received', ({ fromId }) => {
    inbox.add(fromId, store.getState().players[fromId]?.name || loginOf(fromId));
  });
}
