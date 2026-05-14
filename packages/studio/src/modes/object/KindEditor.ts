import { useEffect, useRef } from 'react';
import { useControls } from 'leva';
import {
  CUBE_KIND_CATEGORIES,
  type CubeKindCategory,
  type CubeKindEntry,
} from '@officexr/world';

interface KindEditorOpts {
  /** Currently selected kind (or `null` when nothing is selected). */
  kind: CubeKindEntry | null;
  /** Push a partial patch back into the catalog. The hook calls
   * this whenever a Leva slider fires onChange. */
  applyPatch: (partial: Partial<CubeKindEntry>) => void;
}

/**
 * Leva-driven editor for the selected kind's tunable fields. Mounts
 * one folder per kind id so the Leva persistence layer doesn't try
 * to share slider values across kinds — when the user picks a new
 * kind the panel rebuilds with that kind's current values.
 *
 * Fields:
 *   - label       (string)
 *   - swatch      (color)
 *   - walkable    (bool)
 *   - category    (select)
 *   - scale       (number, 0.1–4)
 *   - tint        (color, nullable)
 *   - opacity     (number 0–1)
 *   - roughness   (number 0–1, nullable)
 *   - metalness   (number 0–1, nullable)
 *   - emissive    (color, nullable)
 *   - emissiveIntensity (number 0–4)
 *
 * Nullable colour / PBR fields are surfaced as a (boolean enable +
 * value) pair — clearing the bool sends `null` back so the catalog
 * stores "use GLTF default" rather than a fixed colour.
 */
export function useKindEditor({ kind, applyPatch }: KindEditorOpts): void {
  // Hold the latest `applyPatch` in a ref so the Leva onChange
  // closures stay stable for the lifetime of one kind's panel.
  // Without this, every render bumps applyPatch's identity, Leva
  // rebuilds its schema, and the slider drag's onChange fires
  // against a stale value.
  const applyRef = useRef(applyPatch);
  useEffect(() => {
    applyRef.current = applyPatch;
  }, [applyPatch]);

  const key = kind ? kind.id : '__none__';
  useControls(
    'Kind',
    () => {
      if (!kind) {
        return {
          tip: {
            value: 'Pick a kind on the left to edit its label, swatch, walkable flag, scale, and material overrides.',
            editable: false,
          },
        };
      }
      const cat = kind.category;
      return {
        id: { value: kind.id, editable: false },
        label: {
          value: kind.label,
          onChange: (v: string) => applyRef.current({ label: v }),
        },
        category: {
          value: cat,
          options: Object.fromEntries(
            CUBE_KIND_CATEGORIES.map((c) => [c, c]),
          ),
          onChange: (v: CubeKindCategory) =>
            applyRef.current({ category: v }),
        },
        swatch: {
          value: kind.swatch,
          onChange: (v: string) => applyRef.current({ swatch: v }),
        },
        walkable: {
          value: kind.walkable,
          onChange: (v: boolean) => applyRef.current({ walkable: v }),
        },
        scale: {
          value: kind.scale,
          min: 0.1,
          max: 4,
          step: 0.05,
          onChange: (v: number) => applyRef.current({ scale: v }),
        },
        'use tint': {
          value: kind.tint !== null,
          onChange: (enabled: boolean) =>
            applyRef.current({ tint: enabled ? (kind.tint ?? '#ffffff') : null }),
        },
        tint: {
          value: kind.tint ?? '#ffffff',
          onChange: (v: string) => {
            if (kind.tint !== null) applyRef.current({ tint: v });
          },
        },
        opacity: {
          value: kind.opacity,
          min: 0,
          max: 1,
          step: 0.05,
          onChange: (v: number) => applyRef.current({ opacity: v }),
        },
        'use roughness': {
          value: kind.roughness !== null,
          onChange: (enabled: boolean) =>
            applyRef.current({
              roughness: enabled ? (kind.roughness ?? 0.5) : null,
            }),
        },
        roughness: {
          value: kind.roughness ?? 0.5,
          min: 0,
          max: 1,
          step: 0.05,
          onChange: (v: number) => {
            if (kind.roughness !== null) applyRef.current({ roughness: v });
          },
        },
        'use metalness': {
          value: kind.metalness !== null,
          onChange: (enabled: boolean) =>
            applyRef.current({
              metalness: enabled ? (kind.metalness ?? 0) : null,
            }),
        },
        metalness: {
          value: kind.metalness ?? 0,
          min: 0,
          max: 1,
          step: 0.05,
          onChange: (v: number) => {
            if (kind.metalness !== null) applyRef.current({ metalness: v });
          },
        },
        'use emissive': {
          value: kind.emissive !== null,
          onChange: (enabled: boolean) =>
            applyRef.current({
              emissive: enabled ? (kind.emissive ?? '#000000') : null,
            }),
        },
        emissive: {
          value: kind.emissive ?? '#000000',
          onChange: (v: string) => {
            if (kind.emissive !== null) applyRef.current({ emissive: v });
          },
        },
        emissiveIntensity: {
          value: kind.emissiveIntensity,
          min: 0,
          max: 4,
          step: 0.1,
          onChange: (v: number) =>
            applyRef.current({ emissiveIntensity: v }),
        },
      } as unknown as Record<string, never>;
    },
    [key],
  );
}
