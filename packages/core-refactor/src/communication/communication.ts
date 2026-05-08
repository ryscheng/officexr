import type { Actions, Bus, PlayerId, Store } from '@officexr/sdk';
import { deriveJitsiRoom } from './jitsi-room.ts';
import type { VoiceAdapter } from './types.ts';

interface CommunicationOpts {
  selfId: PlayerId;
  store: Store;
  actions: Actions;
  bus: Bus;
  voice: VoiceAdapter;
}

/**
 * Headless Communication subsystem. The application-layer bridge between
 * GameState's proximity events and the Voice/Media adapters. It:
 *
 * - subscribes to proximity:entering / proximity:exiting / proximity:exited
 *   on the bus,
 * - tracks the current set of nearby peers,
 * - asks the voice adapter to join the lex-min derived room,
 * - mirrors the chosen room into state.players[selfId].jitsiRoom (so
 *   remote peers can see what room we're in via presence:position broadcast).
 *
 * This file imports nothing from `three` and nothing from `renderer/`,
 * preserving the isolation invariant.
 */
export class Communication {
  private readonly selfId: PlayerId;
  private readonly store: Store;
  private readonly actions: Actions;
  private readonly bus: Bus;
  private readonly voice: VoiceAdapter;

  private nearby = new Set<PlayerId>();
  private currentRoom: string | null = null;
  private offEntering: (() => void) | null = null;
  private offExiting: (() => void) | null = null;
  private offExited: (() => void) | null = null;
  private started = false;

  constructor(opts: CommunicationOpts) {
    this.selfId = opts.selfId;
    this.store = opts.store;
    this.actions = opts.actions;
    this.bus = opts.bus;
    this.voice = opts.voice;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.offEntering = this.bus.on('proximity:entering', ({ otherId }) => {
      this.nearby.add(otherId);
      void this.recompute();
    });
    this.offExiting = this.bus.on('proximity:exiting', ({ otherId }) => {
      this.nearby.delete(otherId);
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
    this.offEntering?.();
    this.offExiting?.();
    this.offExited?.();
    this.started = false;
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
    const target = deriveJitsiRoom(this.selfId, this.nearby);
    if (target === this.currentRoom) return;
    this.currentRoom = target;
    this.actions.setMyJitsiRoom(target);
    this.bus.emit({ kind: 'voice:room-changed', roomId: target });
    await this.voice.joinRoom(target, { selfId: this.selfId });
  }
}
