/**
 * Layout document type and (de)serialization.
 *
 * A LayoutDocument holds only the `SceneCommand[]` for structural
 * geometry (walls, floors, structural pieces). It is the authoring
 * source for the bake pipeline — `bakeLayout` converts it into an
 * optimized GLB via `@gltf-transform`.
 *
 * Design notes:
 * - `groups` is an optional additive field — older on-disk layouts
 *   without it deserialize as if they had `{}` (empty groups). Layouts
 *   share the `CommandGroup` shape with rooms so the shared
 *   SceneEditorCanvas works for both.
 * - Referenced kind IDs are NOT validated at deserialize time against
 *   `isLayoutObject`; that check belongs in the layout editor UI and
 *   the bake service, not here.
 */

import type { SceneCommand, CommandGroup } from './commands.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LayoutDocumentV1 {
  schemaVersion: 1;
  name: string;
  title?: string;
  updatedAt?: number;
  commands: SceneCommand[];
  /**
   * Authoring-time command groupings used by the tile / select / delete
   * tools to treat a cluster of placeObject commands as a unit. The
   * canonical state lives on disk under this field; the runtime
   * cascade maps (`commandToGroup`, `groupMembers`) are derived from
   * it. Optional / defaults to `{}` for back-compat with v1 layouts
   * authored before this field existed.
   */
  groups?: Record<string, CommandGroup>;
  /**
   * Persisted bake-optimization strategy id (one of `BAKE_OPTIMIZERS`
   * keys from `@officexr/world/app/bake-optimizers`). When undefined,
   * the bake service falls back to `defaultOptimizer`. Stored on the
   * document so re-bakes (and CI bakes) reproduce the same artifact.
   */
  optimizer?: string;
}

/** The current (and only) layout document version. */
export type LayoutDocument = LayoutDocumentV1;

/** On-disk wire shape for a v1 layout — identical to LayoutDocumentV1
 * but exposed separately to mirror the `SerializedRoomV*` naming
 * convention used in `serialize.ts`. */
export type SerializedLayoutV1 = {
  schemaVersion: 1;
  name: string;
  title?: string;
  updatedAt?: number;
  commands: SceneCommand[];
  groups?: Record<string, CommandGroup>;
  optimizer?: string;
};

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export interface SerializeLayoutInput {
  name: string;
  title?: string;
  commands: SceneCommand[];
  groups?: Record<string, CommandGroup>;
  optimizer?: string;
}

export function serializeLayout(input: SerializeLayoutInput): SerializedLayoutV1 {
  return {
    schemaVersion: 1,
    name: input.name,
    title: input.title,
    updatedAt: Date.now(),
    commands: input.commands,
    groups: input.groups,
    optimizer: input.optimizer,
  };
}

// ---------------------------------------------------------------------------
// Deserialization
// ---------------------------------------------------------------------------

/**
 * Validates structure + schemaVersion and returns the parsed layout.
 * Throws on validation failure so the caller can surface the error
 * to the user instead of silently yielding an empty layout.
 *
 * Error message format mirrors `deserializeScene` for uniform error
 * handling in consumers.
 */
export function deserializeLayout(raw: unknown): LayoutDocument {
  if (!raw || typeof raw !== 'object') {
    throw new Error('layout: not an object');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    throw new Error('layout: missing string `name`');
  }
  if (obj.schemaVersion !== 1) {
    throw new Error(
      `layout: unsupported schemaVersion ${String(obj.schemaVersion)}`,
    );
  }
  if (!Array.isArray(obj.commands)) {
    throw new Error('layout v1: missing `commands` array');
  }
  return {
    schemaVersion: 1,
    name: obj.name,
    title: typeof obj.title === 'string' ? obj.title : undefined,
    updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : undefined,
    commands: obj.commands as SceneCommand[],
    groups:
      obj.groups && typeof obj.groups === 'object' && !Array.isArray(obj.groups)
        ? (obj.groups as Record<string, CommandGroup>)
        : undefined,
    optimizer: typeof obj.optimizer === 'string' ? obj.optimizer : undefined,
  };
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export function emptyLayoutDocument(name: string, title?: string): LayoutDocument {
  return {
    schemaVersion: 1,
    name,
    title,
    updatedAt: Date.now(),
    commands: [],
  };
}
