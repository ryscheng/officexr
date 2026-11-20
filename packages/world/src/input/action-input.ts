export type ActionId = string;

/** The key each held-style action stands in for; the frame loop reads actions through these keys. */
export const ACTION_KEYS: Readonly<Record<ActionId, string>> = {
  jump: ' ',
  sprint: 'shift',
  poke: 'q',
  cast: 'q',
  mount: 'f',
  sit: 'e',
};

/**
 * Actions held by an on-screen button, merged into the keyboard's key set each frame so a button runs
 * the same code as its key. A press released before a frame reads it still counts for that frame.
 */
export class ActionInput {
  private readonly held = new Set<ActionId>();
  private readonly tapped = new Set<ActionId>();
  private readonly unread = new Set<ActionId>();

  press(id: ActionId): void {
    this.held.add(id);
    this.unread.add(id);
  }

  release(id: ActionId): void {
    if (this.held.delete(id) && this.unread.delete(id)) {
      this.tapped.add(id);
    }
  }

  isDown(id: ActionId): boolean {
    return this.held.has(id);
  }

  releaseAll(): void {
    this.held.clear();
    this.tapped.clear();
    this.unread.clear();
  }

  /** Returns `keys` plus the keys of held and just-tapped actions; call once per frame. */
  mergeInto(keys: ReadonlySet<string>): ReadonlySet<string> {
    if (this.held.size === 0 && this.tapped.size === 0) {
      return keys;
    }
    const merged = new Set(keys);
    for (const id of [...this.held, ...this.tapped]) {
      const key = ACTION_KEYS[id];
      if (key !== undefined) {
        merged.add(key);
      }
    }
    this.tapped.clear();
    this.unread.clear();
    return merged;
  }
}
