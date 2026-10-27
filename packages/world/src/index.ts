// @officexr/world — shared renderer + physics + bots + characters + scenes
// for the studio authoring app and (future) web replacement.
//
// Sub-paths give callers a finer-grained import surface:
//   import { Scene } from '@officexr/world/renderer';
//   import { BotPool } from '@officexr/world/bot';
//
// The root re-exports the most commonly used symbols.

export * from './renderer/index.ts';
export * from './bot/index.ts';
export * from './physics/index.ts';
export * from './characters/index.ts';
export * from './scenes/index.ts';
