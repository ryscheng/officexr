/**
 * Back-compat shim. The studio's authoring REST surface is now served
 * by `vite-plugin-storage.ts`, which mounts `/api/rooms`, `/api/maps`,
 * `/api/cube-kinds`, **and** the legacy `/api/scenes` (for the
 * existing Scenes editor until Task 5 of the studio restructure
 * renames it).
 *
 * Existing callers that imported `@officexr/world/vite-plugin-scene-storage`
 * keep working — this file just re-exports the unified plugin's
 * default export. Prefer `@officexr/world/vite-plugin-storage` in new
 * code; the option shape there is `StudioStoragePluginOptions` (4 sub-
 * sections — rooms / maps / catalog / legacyScenes) and is NOT
 * backwards-compatible with the original `{ scenesDir, basePath }`
 * shape. If you were passing options to the old plugin, migrate them
 * to the new shape now.
 *
 * @deprecated Import from `@officexr/world/vite-plugin-storage` instead.
 */
export { default } from './vite-plugin-storage.ts';
