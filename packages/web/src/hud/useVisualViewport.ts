import { useSyncExternalStore } from 'react';

export type ViewportBox = { height: number; keyboard: number };

type ViewportLike = Pick<VisualViewport, 'height' | 'offsetTop'>;

export function viewportBox(innerHeight: number, visual: ViewportLike | null): ViewportBox {
  if (!visual) {
    return { height: innerHeight, keyboard: 0 };
  }
  return { height: visual.height, keyboard: Math.max(0, Math.round(innerHeight - visual.height - visual.offsetTop)) };
}

let cached: ViewportBox = { height: 0, keyboard: 0 };
function snapshot(): ViewportBox {
  const next = viewportBox(window.innerHeight, window.visualViewport);
  if (next.height !== cached.height || next.keyboard !== cached.keyboard) {
    cached = next;
  }
  return cached;
}

function subscribe(onChange: () => void): () => void {
  const visual = window.visualViewport;
  window.addEventListener('resize', onChange);
  visual?.addEventListener('resize', onChange);
  visual?.addEventListener('scroll', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    visual?.removeEventListener('resize', onChange);
    visual?.removeEventListener('scroll', onChange);
  };
}

const SERVER: ViewportBox = { height: 0, keyboard: 0 };

export function useVisualViewport(): ViewportBox {
  return useSyncExternalStore(subscribe, snapshot, () => SERVER);
}
