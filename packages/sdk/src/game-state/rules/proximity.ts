import type { EventRule } from '../rules.ts';
import {
  CHARACTER_BODY,
  CHARACTER_PROXIMITY_INNER,
  CHARACTER_PROXIMITY_OUTER,
} from '../../collision/materials.ts';

/** Default inner proximity radius. The actual radius lives at
 * `state.worldSettings.proximityRadius` (broadcast & live-tuned); this
 * constant matches what `DEFAULT_WORLD_SETTINGS` ships. */
export const BUBBLE_RADIUS = 3;

/**
 * Two-tier proximity sensor with hysteresis. Each character carries an
 * inner and an outer cylinder; the four `proximity:*` events map to the
 * four boundary crossings:
 *
 *      outside  ──entering──>  outer band  ──entered──>  inner
 *                              (pulse)        (steady, voice on)
 *
 *      inner    ──exiting───>  outer band  ──exited───>  outside
 *                              (pulse, voice stays)        (voice off)
 *
 * - **OUTER cylinder** crossings produce `entering` / `exited`. They drive
 *   the visual approach band and the voice-room *leave* (hysteresis: voice
 *   stays through the inner-OUT crossing and only drops when the body
 *   fully clears the outer band).
 * - **INNER cylinder** crossings produce `entered` / `exiting`. `entered`
 *   joins the voice room; `exiting` is currently a visual-only "still
 *   talking, drifted out of the tight zone" signal.
 */
export const proximityOuterRule: EventRule = {
  kind: 'event',
  pair: [CHARACTER_BODY, CHARACTER_PROXIMITY_OUTER],
  on: ['collision:entered', 'collision:exited'],
  fn: (event, state, bus) => {
    const sensor =
      event.a.material === CHARACTER_PROXIMITY_OUTER ? event.a : event.b;
    const body = event.a.material === CHARACTER_BODY ? event.a : event.b;
    if (sensor.ownerId !== state.selfId) return;
    if (!body.ownerId || body.ownerId === state.selfId) return;
    if (event.kind === 'collision:entered') {
      bus.emit({ kind: 'proximity:entering', otherId: body.ownerId });
    } else {
      bus.emit({ kind: 'proximity:exited', otherId: body.ownerId });
    }
  },
};

export const proximityInnerRule: EventRule = {
  kind: 'event',
  pair: [CHARACTER_BODY, CHARACTER_PROXIMITY_INNER],
  on: ['collision:entered', 'collision:exited'],
  fn: (event, state, bus) => {
    const sensor =
      event.a.material === CHARACTER_PROXIMITY_INNER ? event.a : event.b;
    const body = event.a.material === CHARACTER_BODY ? event.a : event.b;
    if (sensor.ownerId !== state.selfId) return;
    if (!body.ownerId || body.ownerId === state.selfId) return;
    if (event.kind === 'collision:entered') {
      bus.emit({ kind: 'proximity:entered', otherId: body.ownerId });
    } else {
      bus.emit({ kind: 'proximity:exiting', otherId: body.ownerId });
    }
  },
};

/** Convenience tuple — apps that want both bound at once just spread this. */
export const proximityRules: readonly EventRule[] = [
  proximityOuterRule,
  proximityInnerRule,
];

/** @deprecated kept for one release as an alias of `proximityOuterRule`
 *  while existing call sites migrate to the named pair above. */
export const proximityRule = proximityOuterRule;
