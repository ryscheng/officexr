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
 * Leva-driven editor for the selected kind's tunable fields. The
 * `[kind.id]` dep on `useControls` rebuilds the schema whenever the
 * selected kind changes.
 *
 * **Critical onChange detail (Leva v0.10 quirk):** Leva's subscription
 * setup in `useControls` fires every `onChange` once on mount with
 * `info.initial === true`, passing whatever the store currently holds
 * for that path — NOT the schema's `value` field. Worse, Leva keeps
 * non-Special inputs in the module-level store even after refCount
 * drops to 0 (see `store.disposePaths`), and `addData` with the
 * default `override=false` does NOT update the `value` of an existing
 * entry (`Object.assign(input, rest)` excludes `value` by destructure
 * — see `store.addData`). So when the user switches kindA → kindB,
 * the new schema mount finds "Kind.label" still holding A's label,
 * keeps that stale value, and fires `onChange(A.label, …, {initial:
 * true})` against B's handler — which would happily patch B with A's
 * label.
 *
 * Fix: every onChange handler checks `info?.initial` and returns
 * early. Real user edits arrive with `initial: false`.
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
  const [, setLeva] = useControls(
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
      // Leva passes a third arg `{ initial: boolean, ... }` to every
      // onChange invocation. The mount-time fire arrives with
      // `initial: true` and carries Leva's stored value (which can be
      // the previous kind's value — see the header comment). Real
      // user edits arrive with `initial: false`. `isInitial` recognises
      // both Leva's shape and the rare case where info is missing.
      const isInitial = (info: unknown): boolean =>
        !!(info && typeof info === 'object' && (info as { initial?: boolean }).initial);
      return {
        id: { value: kind.id, editable: false },
        label: {
          value: kind.label,
          onChange: (v: string, _path: string, info: unknown) => {
            if (isInitial(info)) return;
            applyRef.current({ label: v });
          },
        },
        category: {
          value: cat,
          options: Object.fromEntries(
            CUBE_KIND_CATEGORIES.map((c) => [c, c]),
          ),
          onChange: (v: CubeKindCategory, _p: string, info: unknown) => {
            if (isInitial(info)) return;
            applyRef.current({ category: v });
          },
        },
        swatch: {
          value: kind.swatch,
          onChange: (v: string, _p: string, info: unknown) => {
            if (isInitial(info)) return;
            applyRef.current({ swatch: v });
          },
        },
        walkable: {
          value: kind.walkable,
          onChange: (v: boolean, _p: string, info: unknown) => {
            if (isInitial(info)) return;
            applyRef.current({ walkable: v });
          },
        },
        scale: {
          value: kind.scale,
          min: 0.1,
          max: 4,
          step: 0.05,
          onChange: (v: number, _p: string, info: unknown) => {
            if (isInitial(info)) return;
            applyRef.current({ scale: v });
          },
        },
        'use tint': {
          value: kind.tint !== null,
          onChange: (enabled: boolean, _p: string, info: unknown) => {
            if (isInitial(info)) return;
            applyRef.current({ tint: enabled ? (kind.tint ?? '#ffffff') : null });
          },
        },
        tint: {
          value: kind.tint ?? '#ffffff',
          onChange: (v: string, _p: string, info: unknown) => {
            if (isInitial(info)) return;
            if (kind.tint !== null) applyRef.current({ tint: v });
          },
        },
        opacity: {
          value: kind.opacity,
          min: 0,
          max: 1,
          step: 0.05,
          onChange: (v: number, _p: string, info: unknown) => {
            if (isInitial(info)) return;
            applyRef.current({ opacity: v });
          },
        },
        'use roughness': {
          value: kind.roughness !== null,
          onChange: (enabled: boolean, _p: string, info: unknown) => {
            if (isInitial(info)) return;
            applyRef.current({
              roughness: enabled ? (kind.roughness ?? 0.5) : null,
            });
          },
        },
        roughness: {
          value: kind.roughness ?? 0.5,
          min: 0,
          max: 1,
          step: 0.05,
          onChange: (v: number, _p: string, info: unknown) => {
            if (isInitial(info)) return;
            if (kind.roughness !== null) applyRef.current({ roughness: v });
          },
        },
        'use metalness': {
          value: kind.metalness !== null,
          onChange: (enabled: boolean, _p: string, info: unknown) => {
            if (isInitial(info)) return;
            applyRef.current({
              metalness: enabled ? (kind.metalness ?? 0) : null,
            });
          },
        },
        metalness: {
          value: kind.metalness ?? 0,
          min: 0,
          max: 1,
          step: 0.05,
          onChange: (v: number, _p: string, info: unknown) => {
            if (isInitial(info)) return;
            if (kind.metalness !== null) applyRef.current({ metalness: v });
          },
        },
        'use emissive': {
          value: kind.emissive !== null,
          onChange: (enabled: boolean, _p: string, info: unknown) => {
            if (isInitial(info)) return;
            applyRef.current({
              emissive: enabled ? (kind.emissive ?? '#000000') : null,
            });
          },
        },
        emissive: {
          value: kind.emissive ?? '#000000',
          onChange: (v: string, _p: string, info: unknown) => {
            if (isInitial(info)) return;
            if (kind.emissive !== null) applyRef.current({ emissive: v });
          },
        },
        emissiveIntensity: {
          value: kind.emissiveIntensity,
          min: 0,
          max: 4,
          step: 0.1,
          onChange: (v: number, _p: string, info: unknown) => {
            if (isInitial(info)) return;
            applyRef.current({ emissiveIntensity: v });
          },
        },
      } as unknown as Record<string, never>;
    },
    [key],
  );

  // Push the new kind's values into Leva's store whenever the
  // selected kind changes. This is load-bearing: Leva's `addData`
  // path (which fires when `[key]` deps change) does NOT update the
  // existing `value` of a path — it only updates settings (min,
  // max, label etc.), see `store.addData` in leva v0.10. Without
  // this `setLeva`, the right-hand panel would keep showing the
  // PREVIOUS kind's slider values even though the schema mounted
  // with a different `value`.
  //
  // `set` does fire each path's onChange subscription with
  // `initial: false`, but the value being set IS `kind.X`, so
  // applying `{X: v}` back to the catalog is an idempotent no-op
  // for an unmodified kind — caught by the no-op guard in
  // `useObjectCatalog.applyPatch`.
  useEffect(() => {
    if (!kind) return;
    setLeva({
      label: kind.label,
      category: kind.category,
      swatch: kind.swatch,
      walkable: kind.walkable,
      scale: kind.scale,
      'use tint': kind.tint !== null,
      tint: kind.tint ?? '#ffffff',
      opacity: kind.opacity,
      'use roughness': kind.roughness !== null,
      roughness: kind.roughness ?? 0.5,
      'use metalness': kind.metalness !== null,
      metalness: kind.metalness ?? 0,
      'use emissive': kind.emissive !== null,
      emissive: kind.emissive ?? '#000000',
      emissiveIntensity: kind.emissiveIntensity,
    } as Parameters<typeof setLeva>[0]);
  }, [kind?.id, setLeva]);
}
