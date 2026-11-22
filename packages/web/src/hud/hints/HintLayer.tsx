import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { HintName } from '../hintFlags';
import { hintCopy } from './hintCopy';
import { HintPlate } from './HintPlate';
import { HINT_GAP, HINT_MAX_WIDTH, middleThird, placeHint, type HintPlacement, type HintSide, type Rect, type Size } from './placeHint';

const FADE_MS = 200;
const REMEASURE_MS = 250;
const DESKTOP_MOVE_Y = 0.88;
const FALLBACK_MARGIN = 16;

type Layout = 'portrait' | 'landscape' | 'desktop';

type Target = { anchor: string; side: HintSide; align?: 'start' | 'end'; pointAt?: string; clearBelow?: string };

const TARGETS: Record<Layout, Partial<Record<HintName, Target>>> = {
  portrait: {
    move: { anchor: '[data-hud-item="Joystick"]', side: 'above' },
    people: { anchor: '[data-people-toggle]', side: 'above', align: 'end' },
    alone: { anchor: '[data-map-toggle]', side: 'below', align: 'end', clearBelow: '[data-hud-zone="topCentre"]' },
  },
  landscape: {
    move: { anchor: '[data-hud-item="Joystick"]', side: 'above' },
    people: { anchor: '[data-people-toggle]', side: 'left' },
    alone: { anchor: '[data-map-toggle]', side: 'below', align: 'end', clearBelow: '[data-hud-zone="topCentre"]' },
  },
  desktop: {
    people: { anchor: '[data-people-toggle]', side: 'below', clearBelow: '[data-hud-zone="topLeft"]' },
    alone: { anchor: '[data-map-toggle]', side: 'below', align: 'end' },
  },
};

const rectOf = (selector: string): Rect | null => {
  const box = document.querySelector(selector)?.getBoundingClientRect();
  return box && box.width > 0 ? { left: box.left, top: box.top, width: box.width, height: box.height } : null;
};

function measure(name: HintName, layout: Layout, size: Size): HintPlacement | null {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  if (name === 'move' && layout === 'desktop') {
    return { left: (viewport.width - size.width) / 2, top: viewport.height * DESKTOP_MOVE_Y - size.height, arrow: null, maxWidth: HINT_MAX_WIDTH };
  }
  const target = TARGETS[layout][name];
  const anchor = target && rectOf(target.anchor);
  if (!target || !anchor) {
    return null;
  }
  const hud = document.querySelector('[data-hud-zone="topLeft"]')?.parentElement?.getBoundingClientRect();
  const bounds = hud
    ? { left: hud.left, top: hud.top, width: hud.width, height: hud.height }
    : { left: FALLBACK_MARGIN, top: FALLBACK_MARGIN, width: viewport.width - 2 * FALLBACK_MARGIN, height: viewport.height - 2 * FALLBACK_MARGIN };
  const joystick = rectOf('[data-hud-item="Joystick"]');
  const point = target.pointAt ? rectOf(target.pointAt) : null;
  const clear = target.clearBelow ? rectOf(target.clearBelow) : null;
  return placeHint({
    anchor,
    size,
    bounds,
    keepClear: [middleThird(viewport), ...(joystick ? [{ ...joystick, width: joystick.width + HINT_GAP }] : [])],
    side: target.side,
    align: target.align,
    pointAt: point ? point.left + point.width / 2 : undefined,
    clearBelow: clear ? clear.top + clear.height + 8 : undefined,
  });
}

export function HintLayer({ hint, coarse, portrait, joystickFloats }: { hint: HintName | null; coarse: boolean; portrait: boolean; joystickFloats: boolean }) {
  const [shown, setShown] = useState<{ name: HintName; text: string } | null>(null);
  const [visible, setVisible] = useState(false);
  const [placement, setPlacement] = useState<HintPlacement | null>(null);
  const plate = useRef<HTMLDivElement>(null);
  const layout: Layout = !coarse ? 'desktop' : portrait ? 'portrait' : 'landscape';

  useEffect(() => {
    if (hint) {
      setShown({ name: hint, text: hintCopy(hint, coarse, joystickFloats) });
      setVisible(true);
      return;
    }
    setVisible(false);
    const timer = setTimeout(() => setShown(null), FADE_MS);
    return () => clearTimeout(timer);
  }, [hint, coarse, joystickFloats]);

  const name = shown?.name;
  useLayoutEffect(() => {
    if (!name) {
      setPlacement(null);
      return;
    }
    const update = () => {
      const el = plate.current;
      const next = el && measure(name, layout, { width: el.offsetWidth, height: el.offsetHeight });
      setPlacement((prev) => (next && prev && next.left === prev.left && next.top === prev.top && next.maxWidth === prev.maxWidth && next.arrow?.offset === prev.arrow?.offset ? prev : next || null));
    };
    update();
    const timer = setInterval(update, REMEASURE_MS);
    window.addEventListener('resize', update);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', update);
    };
  }, [name, layout, shown?.text, placement?.maxWidth]);

  if (!shown || shown.name === 'build') {
    return null;
  }
  return (
    <HintPlate
      ref={plate}
      name={shown.name}
      text={shown.text}
      arrow={placement?.arrow ?? null}
      visible={visible && placement !== null}
      className="fixed"
      style={{ left: placement?.left ?? 0, top: placement?.top ?? 0, maxWidth: placement?.maxWidth }}
    />
  );
}
