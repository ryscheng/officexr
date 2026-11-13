import type { Vec3, WorldObjects } from '@officexr/sdk';
import type { SimBakedColliders, SimCore, SimInput, SimKinds, SimPeer, SimStepResult } from './SimCore.ts';

export interface SimMap {
  worldObjects: WorldObjects;
  kinds: SimKinds;
  bakedColliders: SimBakedColliders[];
}

/** One frame: an optional teleport, then an optional peer sync, then the step. */
export interface SimTraceFrame {
  teleport?: Vec3;
  peers?: SimPeer[];
  step: SimInput;
}

/** Golden record of a `SimCore` run: `outputs[i]` is the step result of `inputs[i]`. */
export interface SimTrace {
  kind: 'movement';
  map: SimMap;
  inputs: SimTraceFrame[];
  outputs: SimStepResult[];
}

/** Plays `inputs` on a fresh `sim` over `map`, recording what each step returns. */
export function recordTrace(sim: SimCore, map: SimMap, inputs: SimTraceFrame[]): SimTrace {
  sim.setStaticColliders(map.worldObjects, map.kinds, map.bakedColliders);
  const outputs = inputs.map((frame) => {
    if (frame.teleport) {
      sim.teleport(frame.teleport);
    }
    if (frame.peers) {
      sim.syncPeers(frame.peers, frame.step.settings.charRadius);
    }
    return sim.step(frame.step);
  });
  return { kind: 'movement', map, inputs, outputs };
}
