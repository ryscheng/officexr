export const EMOTE_BURST = 4;
export const EMOTE_WINDOW_MS = 4000;

export class EmoteRateLimit {
  private sent: number[] = [];

  allow(now: number): boolean {
    this.sent = this.sent.filter((t) => now - t < EMOTE_WINDOW_MS);
    if (this.sent.length >= EMOTE_BURST) {
      return false;
    }
    this.sent.push(now);
    return true;
  }
}
