import { SPELL_COOLDOWN_MS, type PlayerId } from '@officexr/sdk';

/** Lets a little under the cooldown through, so network jitter never drops an honest cast. */
const MIN_GAP_MS = SPELL_COOLDOWN_MS * 0.9;

export class SpellCastGuard {
  private readonly lastCastAt = new Map<PlayerId, number>();

  allow(sender: PlayerId, actorId: PlayerId, held: string | null, now: number): boolean {
    if (actorId !== sender || held !== 'wand') return false;
    const last = this.lastCastAt.get(sender);
    if (last !== undefined && now - last < MIN_GAP_MS) return false;
    this.lastCastAt.set(sender, now);
    return true;
  }

  forget(sender: PlayerId): void {
    this.lastCastAt.delete(sender);
  }
}
