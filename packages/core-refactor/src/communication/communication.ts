import type { Actions, Bus, PlayerId, Store } from '@officexr/sdk';
import { deriveJitsiRoom } from './jitsi-room.ts';
import type { VoiceAdapter } from './types.ts';

/** Runs `fn` after `ms`; returns a function that cancels it. */
export type Schedule = (fn: () => void, ms: number) => () => void;

const LEAVE_DEBOUNCE_MS = 1500;

const defaultSchedule: Schedule = (fn, ms) => {
  const handle = setTimeout(fn, ms);
  return () => clearTimeout(handle);
};

interface CommunicationOpts {
  officeId: string;
  selfId: PlayerId;
  store: Store;
  actions: Actions;
  bus: Bus;
  voice: VoiceAdapter;
  schedule?: Schedule;
}

/**
 * Headless Communication subsystem. The application-layer bridge between
 * GameState's proximity events and the Voice/Media adapters. It:
 *
 * - subscribes to `proximity:entered` (peer crossed the *inner* sensor →
 *   join the voice room) and `proximity:exited` (peer fully cleared the
 *   *outer* sensor → leave the voice room).
 *   The intermediate `proximity:entering` / `proximity:exiting` events
 *   are visual-only — they intentionally don't toggle voice, giving users
 *   a wider berth to talk while drifting between the bands.
 * - tracks the current set of nearby peers,
 * - asks the voice adapter to join the lex-min derived room, leaving it
 *   only once nobody has been nearby for {@link LEAVE_DEBOUNCE_MS} so a
 *   peer jittering on the sensor edge doesn't drop the call,
 * - mirrors the chosen room into state.players[selfId].jitsiRoom.
 */
export class Communication {
  private readonly officeId: string;
  private readonly selfId: PlayerId;
  private readonly store: Store;
  private readonly actions: Actions;
  private readonly bus: Bus;
  private readonly voice: VoiceAdapter;
  private readonly schedule: Schedule;

  private nearby = new Set<PlayerId>();
  private currentRoom: string | null = null;
  private offEntered: (() => void) | null = null;
  private offExited: (() => void) | null = null;
  private started = false;
  private cancelLeave: (() => void) | null = null;

  constructor(opts: CommunicationOpts) {
    this.officeId = opts.officeId;
    this.selfId = opts.selfId;
    this.store = opts.store;
    this.actions = opts.actions;
    this.bus = opts.bus;
    this.voice = opts.voice;
    this.schedule = opts.schedule ?? defaultSchedule;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.offEntered = this.bus.on('proximity:entered', ({ otherId }) => {
      this.nearby.add(otherId);
      void this.recompute();
    });
    this.offExited = this.bus.on('proximity:exited', ({ otherId }) => {
      this.nearby.delete(otherId);
      void this.recompute();
    });
    // Seed nearby from the store in case proximity has already been computed
    // before Communication started (e.g. coming back from a renderer crash).
    const initial = this.store.getState().proximity[this.selfId];
    if (initial) {
      for (const id of initial) this.nearby.add(id);
      void this.recompute();
    }
  }

  stop(): void {
    if (!this.started) return;
    this.offEntered?.();
    this.offExited?.();
    this.started = false;
    this.cancelPendingLeave();
    void this.voice.leaveRoom();
    this.currentRoom = null;
    this.nearby.clear();
  }

  /** Test introspection. */
  getCurrentRoom(): string | null {
    return this.currentRoom;
  }

  getNearby(): ReadonlySet<PlayerId> {
    return this.nearby;
  }

  private async recompute(): Promise<void> {
    const target = deriveJitsiRoom(this.officeId, this.selfId, this.nearby);
    if (target === null) {
      if (this.currentRoom !== null && !this.cancelLeave) {
        this.cancelLeave = this.schedule(() => {
          this.cancelLeave = null;
          void this.leave();
        }, LEAVE_DEBOUNCE_MS);
      }
      return;
    }
    this.cancelPendingLeave();
    if (target === this.currentRoom) return;
    this.setRoom(target);
    await this.voice.joinRoom(target, { selfId: this.selfId });
  }

  private cancelPendingLeave(): void {
    this.cancelLeave?.();
    this.cancelLeave = null;
  }

  private async leave(): Promise<void> {
    this.setRoom(null);
    await this.voice.leaveRoom();
  }

  private setRoom(room: string | null): void {
    this.currentRoom = room;
    this.actions.setMyJitsiRoom(room);
    this.bus.emit({ kind: 'voice:room-changed', roomId: room });
  }
}
