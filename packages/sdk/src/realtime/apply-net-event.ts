import type { Actions } from '../game-state/actions.ts';
import type { ChatMessage } from '../game-state/types.ts';
import type { Clock } from '../test-harness/time.ts';
import type { NetEvent } from './protocol.ts';

/**
 * Apply a single validated, non-snapshot NetEvent to a Store via its
 * Actions. The InboundRouter uses this internally; the realtime server
 * uses it to keep its authoritative store in sync with everything that
 * flows over the hub. Does *not* touch anti-echo state — callers that
 * also broadcast outbound events must track that separately.
 */
export function applyNetEventToStore(
  actions: Actions,
  event: NetEvent,
  clock: Clock,
): void {
  switch (event.kind) {
    case 'presence:position':
      actions.applyRemotePosition(
        event.actorId,
        event.pos,
        event.vel,
        event.yaw,
        clock.now(),
      );
      return;
    case 'chat:message': {
      const msg: ChatMessage = {
        id: `${event.actorId}:${event.seq}`,
        authorId: event.actorId,
        text: event.text,
        t: event.t,
      };
      actions.applyRemoteChat(msg);
      return;
    }
    case 'whiteboard:stroke':
      actions.applyRemoteStroke(event.stroke);
      return;
    case 'avatar:update':
      actions.upsertPlayer({ id: event.actorId, avatar: event.avatar });
      return;
    case 'shot:hit':
      actions.applyHit(event.targetId, event.dmg, event.actorId);
      return;
    case 'zombie:state':
      actions.applyZombieState(event.state);
      return;
    case 'world:settings':
      actions.applyRemoteWorldSettings(event.settings);
      return;
    case 'world:map':
      actions.applyRemoteWorldMap(event.map);
      return;
    case 'snapshot:request':
    case 'snapshot:offer':
      // owned by SnapshotHandshake; callers should filter these out.
      return;
  }
  // Exhaustiveness check — adding a new NetEvent kind without a case here
  // is a compile-time error.
  const _exhaustive: never = event;
  void _exhaustive;
}
