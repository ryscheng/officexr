import type {
  RealtimeChannel as SbRealtimeChannel,
  SupabaseClient,
} from '@supabase/supabase-js';
import type { PlayerId } from '../game-state/types.ts';
import type { Channel, PresenceData } from './channel.ts';
import { validateNetEvent, type NetEvent } from './protocol.ts';

const BROADCAST_EVENT = 'office-net-event';

export interface SupabaseChannelOpts {
  supabase: SupabaseClient;
  officeId: string;
  userId: PlayerId;
}

/**
 * Production Channel implementation backed by Supabase Realtime.
 * Mirrors InMemoryChannel's contract:
 * - send delivers to other peers (self:false)
 * - presence join/leave fires onPresenceChange handlers
 * - listPresent reflects currently subscribed peers
 *
 * NOTE: this adapter intentionally uses a single broadcast event name
 * (BROADCAST_EVENT) since every NetEvent is wrapped in an envelope and
 * fanned out by the sync engine. This keeps the channel adapter
 * agnostic of the protocol's `kind` field.
 */
export class SupabaseChannel implements Channel {
  private supabase: SupabaseClient;
  private officeId: string;
  public readonly userId: PlayerId;

  private channel: SbRealtimeChannel | null = null;
  private subscribed = false;
  private closed = false;

  private handlers = new Set<(event: NetEvent) => void>();
  private presenceHandlers = new Set<
    (joined: PlayerId[], left: PlayerId[]) => void
  >();

  // Track remote presence keys ourselves so we can compute joined/left diffs.
  private knownPresenceKeys = new Set<PlayerId>();
  // Latest presence data published by self (so trackPresence works after subscribe).
  private myPresenceData: PresenceData | null = null;

  constructor(opts: SupabaseChannelOpts) {
    this.supabase = opts.supabase;
    this.officeId = opts.officeId;
    this.userId = opts.userId;
  }

  async subscribe(): Promise<void> {
    if (this.subscribed || this.closed) return;
    const channel = this.supabase.channel(`office:${this.officeId}`, {
      config: {
        presence: { key: this.userId },
        broadcast: { ack: true, self: false },
      },
    });
    this.channel = channel;

    channel.on('broadcast', { event: BROADCAST_EVENT }, (payload) => {
      const raw = payload?.payload;
      if (!raw) return;
      // Validate at the boundary so junk doesn't reach the engine.
      const result = validateNetEvent(raw);
      if (!result.ok) return;
      this.dispatch(result.event);
    });

    channel.on('presence', { event: 'sync' }, () => this.handlePresenceSync());
    channel.on('presence', { event: 'join' }, ({ key }) => {
      if (typeof key !== 'string') return;
      if (key === this.userId) return;
      if (this.knownPresenceKeys.has(key)) return;
      this.knownPresenceKeys.add(key);
      this.firePresence([key], []);
    });
    channel.on('presence', { event: 'leave' }, ({ key }) => {
      if (typeof key !== 'string') return;
      if (!this.knownPresenceKeys.has(key)) return;
      this.knownPresenceKeys.delete(key);
      this.firePresence([], [key]);
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('subscribe timeout')), 10_000);
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer);
          this.subscribed = true;
          if (this.myPresenceData) {
            void channel.track(this.myPresenceData);
          }
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          clearTimeout(timer);
          reject(new Error(`subscribe failed: ${status}`));
        }
      });
    });
  }

  async send(event: NetEvent): Promise<void> {
    if (this.closed || !this.subscribed || !this.channel) return;
    const result = await this.channel.send({
      type: 'broadcast',
      event: BROADCAST_EVENT,
      payload: event,
    });
    if (result !== 'ok') {
      // ack failure — surface for debugging
      console.warn('[supabase-channel] send ack:', result);
    }
  }

  on(handler: (event: NetEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  trackPresence(data: PresenceData): void {
    this.myPresenceData = data;
    if (this.subscribed && this.channel) {
      void this.channel.track(data);
    }
  }

  onPresenceChange(
    handler: (joined: PlayerId[], left: PlayerId[]) => void,
  ): () => void {
    this.presenceHandlers.add(handler);
    return () => this.presenceHandlers.delete(handler);
  }

  listPresent(): PlayerId[] {
    const list = Array.from(this.knownPresenceKeys);
    if (this.subscribed) list.push(this.userId);
    return list;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.subscribed = false;
    if (this.channel) {
      void this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.handlers.clear();
    this.presenceHandlers.clear();
    this.knownPresenceKeys.clear();
  }

  // -----

  private dispatch(event: NetEvent): void {
    for (const h of [...this.handlers]) {
      try {
        h(event);
      } catch (err) {
        console.error('[supabase-channel] handler threw:', err);
      }
    }
  }

  private firePresence(joined: PlayerId[], left: PlayerId[]): void {
    if (joined.length === 0 && left.length === 0) return;
    for (const h of [...this.presenceHandlers]) {
      try {
        h(joined, left);
      } catch (err) {
        console.error('[supabase-channel] presence handler threw:', err);
      }
    }
  }

  private handlePresenceSync(): void {
    if (!this.channel) return;
    const state = this.channel.presenceState();
    const seen = new Set<PlayerId>();
    for (const key of Object.keys(state)) {
      if (key === this.userId) continue;
      seen.add(key);
    }
    const joined: PlayerId[] = [];
    const left: PlayerId[] = [];
    for (const id of seen) {
      if (!this.knownPresenceKeys.has(id)) joined.push(id);
    }
    for (const id of this.knownPresenceKeys) {
      if (!seen.has(id)) left.push(id);
    }
    this.knownPresenceKeys = seen;
    this.firePresence(joined, left);
  }
}
