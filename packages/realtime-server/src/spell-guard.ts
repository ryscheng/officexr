import { SPELL_COOLDOWN_MS, type PlayerId } from '@officexr/sdk';

/** Lets a little under the cooldown through, so network jitter never drops an honest cast. */
const MIN_GAP_MS = SPELL_COOLDOWN_MS * 0.9;

/** Keeps each caster to one cast per cooldown; keyed by player, not socket, so a reconnect does not reset it. */
export class SpellCastGuard {
  private readonly lastCastAt = new Map<PlayerId, number>();

  allow(sender: PlayerId, eligible: boolean, now: number): boolean {
    if (!eligible) return false;
    const last = this.lastCastAt.get(sender);
    if (last !== undefined && now - last < MIN_GAP_MS) return false;
    this.lastCastAt.set(sender, now);
    return true;
  }
}
