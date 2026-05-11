import type { WsChannel } from '@officexr/realtime-server';
import type { BotMode } from '../bot/BotDriver.ts';

/**
 * Control-plane messages the browser sends to the Node bot CLI over
 * the same realtime WebSocket as the local-player channel. Carried as
 * `{ t: 'custom', kind, payload }` frames — kept off the SDK NetEvent
 * protocol because bot orchestration is a debug-tool concern, not a
 * game-state concern.
 */
export type BotControlMsg =
  | { type: 'set-count'; count: number }
  | { type: 'set-mode'; mode: BotMode };

const KIND_SET_COUNT = 'bots:set-count';
const KIND_SET_MODE = 'bots:set-mode';

export interface BotControlPublisher {
  publish(msg: BotControlMsg): void;
  close(): void;
}

/**
 * Wraps a {@link WsChannel} with the bot-control frame protocol. The
 * channel must already be subscribed; closing the publisher does not
 * close the underlying channel (the page owns its lifetime).
 */
export function createBotControlPublisher(opts: {
  channel: WsChannel;
}): BotControlPublisher {
  let closed = false;
  return {
    publish(msg) {
      if (closed) return;
      if (msg.type === 'set-count') {
        opts.channel.sendCustom(KIND_SET_COUNT, { count: msg.count });
      } else if (msg.type === 'set-mode') {
        opts.channel.sendCustom(KIND_SET_MODE, { mode: msg.mode });
      }
    },
    close() {
      closed = true;
    },
  };
}
