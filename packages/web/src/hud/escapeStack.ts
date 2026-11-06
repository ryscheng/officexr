import { isTypingTarget } from '@officexr/world/top-down';

export interface EscapeLayer {
  onEscape: () => void;
  /** Handle Esc pressed inside a text field, for a layer that owns its input. */
  ownsTyping?: boolean;
}

/** Overlays in the order they opened. One Esc closes only the topmost; with none open, it runs the fallback. */
export class EscapeStack {
  private layers: EscapeLayer[] = [];
  private fallback: (() => void) | null = null;
  private listening = false;

  constructor(private readonly doc: Document = document) {}

  push(layer: EscapeLayer): () => void {
    this.layers.push(layer);
    this.sync();
    return () => {
      this.layers = this.layers.filter((l) => l !== layer);
      this.sync();
    };
  }

  /** Runs on Esc when no layer is open and the pointer is free. */
  setFallback(fallback: (() => void) | null): void {
    this.fallback = fallback;
    this.sync();
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.isComposing) {
      return;
    }
    const top = this.layers.at(-1);
    if (top) {
      if (!isTypingTarget(e.target) || top.ownsTyping) {
        e.preventDefault();
        top.onEscape();
      }
    } else if (this.fallback && !isTypingTarget(e.target) && this.doc.pointerLockElement == null) {
      e.preventDefault();
      this.fallback();
    }
  };

  private sync() {
    const wanted = this.layers.length > 0 || this.fallback !== null;
    if (wanted && !this.listening) {
      this.doc.defaultView?.addEventListener('keydown', this.onKeyDown);
    } else if (!wanted && this.listening) {
      this.doc.defaultView?.removeEventListener('keydown', this.onKeyDown);
    }
    this.listening = wanted;
  }
}

export const escapeStack = new EscapeStack();
