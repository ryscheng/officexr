const MAX_ENTRIES = 50;

export interface ChatHistory {
  push(text: string): void;
  /** The previous sent message, or null when the draft is not empty and not being browsed. */
  older(draft: string): string | null;
  /** The next message while browsing, an empty string past the newest, or null when not browsing. */
  newer(): string | null;
  stopBrowsing(): void;
}

export function createChatHistory(): ChatHistory {
  const entries: string[] = [];
  let cursor = 0;
  return {
    push(text) {
      if (entries.at(-1) !== text) {
        entries.push(text);
        if (entries.length > MAX_ENTRIES) {
          entries.shift();
        }
      }
      cursor = entries.length;
    },
    older(draft) {
      const browsing = cursor < entries.length;
      if ((!browsing && draft !== '') || entries.length === 0) {
        return null;
      }
      cursor = Math.max(0, cursor - 1);
      return entries[cursor] ?? null;
    },
    newer() {
      if (cursor >= entries.length) {
        return null;
      }
      cursor += 1;
      return entries[cursor] ?? '';
    },
    stopBrowsing() {
      cursor = entries.length;
    },
  };
}
