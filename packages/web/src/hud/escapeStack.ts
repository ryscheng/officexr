import { isTypingTarget } from '@officexr/world/top-down';
import { isComposing } from './isComposing';

export interface EscapeLayer {
  onEscape: () => void;
  /** The layer's own element: Esc pressed in a text field inside it is handled, elsewhere it is ignored. */
  owns?: () => Element | null;
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
  setFallback(fallback: () => void): () => void {
    this.fallback = fallback;
    this.sync();
    return () => {
      if (this.fallback === fallback) {
        this.fallback = null;
        this.sync();
      }
    };
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.repeat || isComposing(e)) {
      return;
    }
    const typing = isTypingTarget(e.target);
    const top = this.layers.at(-1);
    if (top) {
      if (!typing || (e.target instanceof Node && top.owns?.()?.contains(e.target))) {
        e.preventDefault();
        top.onEscape();
      }
    } else if (this.fallback && !typing && this.doc.pointerLockElement == null) {
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
