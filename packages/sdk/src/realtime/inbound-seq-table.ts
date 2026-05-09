import type { PlayerId } from '../game-state/types.ts';

/**
 * Per-actor monotonic seq table. Shared collaborator between SyncEngine
 * (which writes on inbound application) and SnapshotHandshake (which
 * seeds it from a received snapshot:offer.seqTable, and reads it when
 * the local client is the leader and needs to ship its own seqTable).
 *
 * Owning this state in a separate object kills the leaky-abstraction
 * smell where SnapshotHandshake had to poke SyncEngine's private map.
 */
export class InboundSeqTable {
  private table = new Map<PlayerId, number>();

  /** True if this `(actorId, seq)` pair has already been applied. */
  isDuplicate(actorId: PlayerId, seq: number): boolean {
    const last = this.table.get(actorId);
    return last !== undefined && seq <= last;
  }

  /** Mark `(actorId, seq)` as applied. No-op if a higher seq is already recorded. */
  markSeen(actorId: PlayerId, seq: number): void {
    const last = this.table.get(actorId) ?? 0;
    if (seq > last) this.table.set(actorId, seq);
  }

  /**
   * Merge a snapshot's seq table in. Each entry only advances forward —
   * an older `seq` from the snapshot doesn't override a higher one we've
   * already seen live.
   */
  seed(table: Record<PlayerId, number>): void {
    for (const [actorId, seq] of Object.entries(table)) {
      const current = this.table.get(actorId) ?? 0;
      if (seq > current) this.table.set(actorId, seq);
    }
  }

  /** Plain-object copy for shipping inside `snapshot:offer.seqTable`. */
  snapshot(): Record<PlayerId, number> {
    return Object.fromEntries(this.table);
  }
}
