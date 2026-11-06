import { useEffect, useMemo } from 'react';
import { deskOwnedBy, loginOf, type Actions, type OfficeState, type PlayerId, type Store, type Vec3 } from '@officexr/sdk';
import type { KindResolver } from '../app/geometry-service.ts';
import {
  canSit,
  closestSeat,
  seatedPlayerPose,
  seatsOf,
  SIT_RADIUS_M,
  stepOutSpot,
  type Seat,
  type SitRefusal,
} from '../app/seating.ts';
import type { InstanceGeometryService } from '../app/types.ts';
import { bodyPosition, feetPosition } from '../physics/rules.ts';
import type { SeatingSource } from '../renderer/seated.ts';
import { useApplication } from './application-context.tsx';
import type { PlayControlsSource, SeatingState } from './playControls.tsx';
import type { AutoWalkController } from './useAutoWalk.ts';

const REFUSAL_TOAST_MS = 2000;
const ZERO = { x: 0, y: 0, z: 0 };

export interface SeatingControllerState extends SeatingState {
  /** Why the last sit failed, until its toast times out. */
  refusal: SitRefusal | null;
}

export interface SeatingController extends SeatingSource {
  sit(instanceId?: string): void;
  returnToDesk(): void;
  getState(): SeatingControllerState;
  subscribe(cb: () => void): () => void;
  /** Tracks the store until the returned function is called. */
  start(): () => void;
}

export interface SeatingDeps {
  store: Store;
  actions: Pick<Actions, 'setSelfPosition' | 'setSelfSeat'>;
  selfId: PlayerId;
  catalog: KindResolver;
  geometry: Pick<InstanceGeometryService, 'worldAABB' | 'worldAABBOfInstance'>;
  autoWalk: Pick<AutoWalkController, 'cancel' | 'goToPoint'>;
}

/** Sits the self player of `store` on seats and stands them back up. */
export function createSeating({ store, actions, selfId, catalog, geometry, autoWalk }: SeatingDeps): SeatingController {
  const login = loginOf(selfId);
  let state: SeatingControllerState = { nearbySeatId: null, hasDesk: false, refusal: null };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<SeatingControllerState>) => {
    const next = { ...state, ...patch };
    if (next.nearbySeatId !== state.nearbySeatId || next.hasDesk !== state.hasDesk || next.refusal !== state.refusal) {
      state = next;
      listeners.forEach((cb) => cb());
    }
  };
  let refusalTimer: ReturnType<typeof setTimeout> | undefined;
  let isFree: (feet: Vec3) => boolean = () => true;
  /** Where `sit` put the player; any other position while seated means a teleport. */
  let seatedAt: Vec3 | null = null;

  let seatsFor: OfficeState['worldObjects'] | null = null;
  let seats: Seat[] = [];
  const seatsOfState = (s: OfficeState) => {
    if (s.worldObjects !== seatsFor) {
      seatsFor = s.worldObjects;
      seats = seatsOf(s.worldObjects.instances, catalog, geometry);
    }
    return seats;
  };
  const seatById = (s: OfficeState, id: string) => seatsOfState(s).find((seat) => seat.instance.id === id) ?? null;
  const ownDeskSeatId = (s: OfficeState) => {
    const deskId = deskOwnedBy(s, login);
    return s.deskAreas.find((a) => a.id === deskId)?.seatInstanceId ?? null;
  };
  const standingSpot = (seat: Seat) => stepOutSpot(seat.pose, geometry.worldAABBOfInstance(seat.instance), isFree);

  const sit = (instanceId?: string) => {
    const s = store.getState();
    const self = s.players[selfId];
    if (!self) {
      return;
    }
    const { charRadius } = s.worldSettings;
    const seat =
      instanceId === undefined
        ? closestSeat(seatsOfState(s), feetPosition(self.pos, charRadius), SIT_RADIUS_M)
        : seatById(s, instanceId);
    if (!seat || self.seat === seat.instance.id) {
      return;
    }
    const verdict = canSit(s, catalog, geometry, seat.instance, login);
    if (!verdict.ok) {
      clearTimeout(refusalTimer);
      publish({ refusal: verdict.reason });
      refusalTimer = setTimeout(() => publish({ refusal: null }), REFUSAL_TOAST_MS);
      return;
    }
    autoWalk.cancel();
    const { pos, yaw } = seatedPlayerPose(seat.pose, charRadius);
    seatedAt = pos;
    actions.setSelfPosition(pos, ZERO, yaw, false);
    actions.setSelfSeat(seat.instance.id);
  };

  const stand = () => {
    const s = store.getState();
    const self = s.players[selfId];
    if (self?.seat == null) {
      return;
    }
    seatedAt = null;
    const seat = seatById(s, self.seat);
    if (seat) {
      actions.setSelfPosition(bodyPosition(standingSpot(seat), s.worldSettings.charRadius), ZERO, self.yaw, false);
    }
    actions.setSelfSeat(null);
  };

  const track = (s: OfficeState) => {
    const self = s.players[selfId];
    if (self?.seat != null && seatedAt && !samePosition(self.pos, seatedAt)) {
      seatedAt = null;
      actions.setSelfSeat(null);
      return;
    }
    const seat = self ? closestSeat(seatsOfState(s), feetPosition(self.pos, s.worldSettings.charRadius), SIT_RADIUS_M) : null;
    publish({
      nearbySeatId: seat && canSit(s, catalog, geometry, seat.instance, login).ok ? seat.instance.id : null,
      hasDesk: ownDeskSeatId(s) !== null,
    });
  };

  return {
    sit,
    stand,
    returnToDesk() {
      const s = store.getState();
      const seatId = ownDeskSeatId(s);
      const seat = seatId === null ? null : seatById(s, seatId);
      if (seat && s.players[selfId]?.seat !== seatId) {
        autoWalk.goToPoint(seat.instance.id, standingSpot(seat), () => sit(seat.instance.id));
      }
    },
    setStandingCheck(check) {
      isFree = check;
      return () => {
        if (isFree === check) {
          isFree = () => true;
        }
      };
    },
    getState: () => state,
    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    start() {
      track(store.getState());
      const unsubscribe = store.subscribeAll((next) => track(next));
      return () => {
        unsubscribe();
        clearTimeout(refusalTimer);
      };
    },
  };
}

function samePosition(a: Vec3, b: Vec3): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;
}

/** The overlay-facing controls: auto-walk plus seating, notifying on either's change. */
export function playControlsOf(
  autoWalk: Pick<AutoWalkController, 'goTo' | 'cancel' | 'getState' | 'subscribe'>,
  seating: SeatingController,
): PlayControlsSource {
  return {
    goTo: autoWalk.goTo,
    cancel: autoWalk.cancel,
    getState: autoWalk.getState,
    subscribe(cb) {
      const offWalk = autoWalk.subscribe(cb);
      const offSeating = seating.subscribe(cb);
      return () => {
        offWalk();
        offSeating();
      };
    },
    sit: seating.sit,
    stand: seating.stand,
    returnToDesk: seating.returnToDesk,
    getSeating: seating.getState,
  };
}

/** One controller per `store`, `actions` and `selfId`, tracking the store while mounted. */
export function useSeating(
  store: Store,
  actions: SeatingDeps['actions'],
  selfId: PlayerId,
  autoWalk: SeatingDeps['autoWalk'],
): SeatingController {
  const { catalog, geometry } = useApplication();
  const seating = useMemo(
    () => createSeating({ store, actions, selfId, catalog, geometry, autoWalk }),
    [store, actions, selfId, catalog, geometry, autoWalk],
  );
  useEffect(() => seating.start(), [seating]);
  return seating;
}
