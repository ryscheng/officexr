import type { PlayerId } from '../game-state/types.ts';
import type { NetEvent } from './protocol.ts';

export type PresenceData = Record<string, unknown>;

export interface Channel {
  subscribe(): Promise<void>;
  send(event: NetEvent): Promise<void>;
  on(handler: (event: NetEvent) => void): () => void;
  trackPresence(data: PresenceData): void;
  onPresenceChange(handler: (joined: PlayerId[], left: PlayerId[]) => void): () => void;
  listPresent(): PlayerId[];
  close(): void;
}

// --- In-memory implementation for tests / harness ---

interface Hub {
  attach(client: InMemoryChannel): void;
  detach(client: InMemoryChannel): void;
  broadcast(senderId: PlayerId, event: NetEvent): void;
  trackPresence(senderId: PlayerId, data: PresenceData): void;
  present(): PlayerId[];
}

export function createInMemoryChannelHub(): Hub {
  const clients = new Map<PlayerId, InMemoryChannel>();
  const presence = new Map<PlayerId, PresenceData>();

  return {
    attach(client) {
      const wasPresent = clients.has(client.userId);
      clients.set(client.userId, client);
      if (!wasPresent) {
        // notify others of join (presence reported separately when trackPresence is called)
      }
    },
    detach(client) {
      // Identity-check: if a *different* channel with the same userId has
      // since overwritten the entry (e.g. React strict-mode double-mount
      // re-creates the local channel between attach and the detach the
      // first effect's cleanup eventually runs), don't evict the live one.
      const stored = clients.get(client.userId);
      if (stored !== client) return;
      const wasPresent = presence.has(client.userId);
      clients.delete(client.userId);
      presence.delete(client.userId);
      if (wasPresent) {
        for (const [id, c] of clients) {
          if (id === client.userId) continue;
          c._handlePresenceChange([], [client.userId]);
        }
      }
    },
    broadcast(senderId, event) {
      for (const [id, c] of clients) {
        if (id === senderId) continue;
        c._deliver(event);
      }
    },
    trackPresence(senderId, data) {
      const wasPresent = presence.has(senderId);
      presence.set(senderId, data);
      if (!wasPresent) {
        for (const [id, c] of clients) {
          if (id === senderId) continue;
          c._handlePresenceChange([senderId], []);
        }
      }
    },
    present() {
      return Array.from(presence.keys());
    },
  };
}

export class InMemoryChannel implements Channel {
  private hub: Hub;
  public readonly userId: PlayerId;
  private subscribed = false;
  private closed = false;
  private handlers = new Set<(event: NetEvent) => void>();
  private presenceHandlers = new Set<
    (joined: PlayerId[], left: PlayerId[]) => void
  >();

  constructor(hub: Hub, userId: PlayerId) {
    this.hub = hub;
    this.userId = userId;
  }

  async subscribe(): Promise<void> {
    if (this.subscribed || this.closed) return;
    this.subscribed = true;
    this.hub.attach(this);
  }

  async send(event: NetEvent): Promise<void> {
    if (this.closed || !this.subscribed) return;
    this.hub.broadcast(this.userId, event);
  }

  on(handler: (event: NetEvent) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  trackPresence(data: PresenceData): void {
    if (this.closed) return;
    this.hub.trackPresence(this.userId, data);
  }

  onPresenceChange(
    handler: (joined: PlayerId[], left: PlayerId[]) => void,
  ): () => void {
    this.presenceHandlers.add(handler);
    return () => {
      this.presenceHandlers.delete(handler);
    };
  }

  listPresent(): PlayerId[] {
    return this.hub.present();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.subscribed = false;
    this.hub.detach(this);
    this.handlers.clear();
    this.presenceHandlers.clear();
  }

  // hub-internal --------------------------------------------------

  _deliver(event: NetEvent): void {
    if (this.closed) return;
    for (const h of [...this.handlers]) {
      try {
        h(event);
      } catch (err) {
        console.error('[channel] handler threw:', err);
      }
    }
  }

  _handlePresenceChange(joined: PlayerId[], left: PlayerId[]): void {
    if (this.closed) return;
    for (const h of [...this.presenceHandlers]) {
      try {
        h(joined, left);
      } catch (err) {
        console.error('[channel] presence handler threw:', err);
      }
    }
  }
}
