import RAPIER from '@dimforge/rapier3d-compat';

// Rapier ships as WebAssembly; the compat wrapper needs an async init
// before any `new RAPIER.World(...)` call works. The bots-cli does this
// itself in production, but vitest spawns a fresh module graph per
// test file so we need to await init once before tests start.
await RAPIER.init();
