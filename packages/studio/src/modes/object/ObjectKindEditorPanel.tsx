import React, { Suspense, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import {
  CUBE_KIND_CATEGORIES,
  type CubeKindCategory,
  type OptimizationMode,
  type WorldObjectKind,
} from '@officexr/world';
import { getKindBoundingDimensions } from '@officexr/world/renderer';

import { Button } from '../../components/ui/button.tsx';
import {
  ColorInput,
  NullableField,
  NumberInput,
  Panel,
  Readonly,
  Section,
  SelectInput,
  Toggle,
} from '../../ui/controls/index.ts';

interface ObjectKindEditorPanelProps {
  kind: WorldObjectKind | null;
  applyPatch: (partial: Partial<WorldObjectKind>) => void;
}

/**
 * Right-hand panel for the Object editor. Replaces the previous
 * `useKindEditor` Leva hook + its workarounds for Leva's mount-fire
 * bug (`info.initial` guards and the imperative `setLeva({...})`
 * push — see git history for the gory details).
 *
 * Every field is a fully-controlled React input. `kind` comes in
 * from `useObjectCatalog`; every edit fires `applyPatch(partial)`
 * which routes through the existing no-op guard in
 * `useObjectCatalog.applyPatch` to the catalog mutator. The bug
 * that motivated this whole migration becomes structurally
 * impossible: there is no shared store between the previous kind
 * and the new kind to leak across.
 */
export function ObjectKindEditorPanel({ kind, applyPatch }: ObjectKindEditorPanelProps) {
  if (!kind) {
    return (
      <Panel>
        <div className="px-3 py-3 text-xs text-muted-foreground">
          Pick a kind on the left to edit its label, swatch, walkable
          flag, scale, and material overrides.
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      <Section title="Kind">
        <Readonly label="id" value={kind.id} />
        <LabelInput
          value={kind.label}
          onChange={(label) => applyPatch({ label })}
        />
        <SelectInput
          label="category"
          value={kind.category}
          options={CUBE_KIND_CATEGORIES as unknown as readonly CubeKindCategory[]}
          onChange={(category) => applyPatch({ category })}
        />
        <ColorInput
          label="swatch"
          value={kind.swatch}
          onChange={(swatch) => applyPatch({ swatch })}
        />
        <Toggle
          label="walkable"
          value={kind.walkable}
          onChange={(walkable) => applyPatch({ walkable })}
        />
        <NumberInput
          label="scale"
          value={kind.scale}
          min={0.1}
          max={4}
          step={0.05}
          onChange={(scale) => applyPatch({ scale })}
        />
      </Section>

      <Section title="Dimensions">
        <Suspense fallback={<DimensionsFallback />}>
          <KindDimensionsEditor
            gltfPath={kind.gltfPath}
            scale={kind.scale}
            dimensions={kind.dimensions}
            applyPatch={applyPatch}
          />
        </Suspense>
      </Section>

      <Section title="Material overrides">
        <NullableField<string>
          label="tint"
          value={kind.tint}
          defaultValue="#ffffff"
          onChange={(tint) => applyPatch({ tint })}
        >
          {(value, onChange) => (
            <ColorInput label="" value={value} onChange={onChange} />
          )}
        </NullableField>
        <NumberInput
          label="opacity"
          value={kind.opacity}
          min={0}
          max={1}
          step={0.05}
          onChange={(opacity) => applyPatch({ opacity })}
        />
        <NullableField<number>
          label="roughness"
          value={kind.roughness}
          defaultValue={0.5}
          onChange={(roughness) => applyPatch({ roughness })}
        >
          {(value, onChange) => (
            <NumberInput
              label=""
              value={value}
              min={0}
              max={1}
              step={0.05}
              onChange={onChange}
            />
          )}
        </NullableField>
        <NullableField<number>
          label="metalness"
          value={kind.metalness}
          defaultValue={0}
          onChange={(metalness) => applyPatch({ metalness })}
        >
          {(value, onChange) => (
            <NumberInput
              label=""
              value={value}
              min={0}
              max={1}
              step={0.05}
              onChange={onChange}
            />
          )}
        </NullableField>
        <NullableField<string>
          label="emissive"
          value={kind.emissive}
          defaultValue="#000000"
          onChange={(emissive) => applyPatch({ emissive })}
        >
          {(value, onChange) => (
            <ColorInput label="" value={value} onChange={onChange} />
          )}
        </NullableField>
        <NumberInput
          label="emissive intensity"
          value={kind.emissiveIntensity}
          min={0}
          max={4}
          step={0.1}
          onChange={(emissiveIntensity) => applyPatch({ emissiveIntensity })}
        />
      </Section>

      <Section title="Tiling">
        <Toggle
          label="tile X"
          value={kind.tilingAxes.x}
          onChange={(v) => applyPatch({ tilingAxes: { ...kind.tilingAxes, x: v } })}
        />
        <Toggle
          label="tile Y"
          value={kind.tilingAxes.y}
          onChange={(v) => applyPatch({ tilingAxes: { ...kind.tilingAxes, y: v } })}
        />
        <Toggle
          label="tile Z"
          value={kind.tilingAxes.z}
          onChange={(v) => applyPatch({ tilingAxes: { ...kind.tilingAxes, z: v } })}
        />
      </Section>

      <Section title="Placement">
        <Toggle
          label="gravity"
          value={kind.gravity}
          onChange={(gravity) => applyPatch({ gravity })}
        />
        <Toggle
          label="Is layout object"
          value={kind.isLayoutObject}
          onChange={(isLayoutObject) => applyPatch({ isLayoutObject })}
          hint="Walls, floors, structural geometry. Used in Layout view; hidden from Room view by default."
        />
      </Section>

      <Section title="Optimization">
        <SelectInput
          label="mode"
          value={kind.optimization}
          options={['none', 'static-batch', 'frustum-cull'] as readonly OptimizationMode[]}
          onChange={(optimization) => applyPatch({ optimization })}
        />
        <Readonly label="" value="scaffold — no runtime effect" />
      </Section>
    </Panel>
  );
}

/** @deprecated Use ObjectKindEditorPanel */
export const KindEditorPanel = ObjectKindEditorPanel;

interface LabelInputProps {
  value: string;
  onChange: (next: string) => void;
}

interface KindDimensionsEditorProps {
  gltfPath: string;
  scale: number;
  dimensions: { width: number; height: number; depth: number } | undefined;
  applyPatch: (partial: Partial<WorldObjectKind>) => void;
}

/**
 * Width / height / depth editor backed by the kind's `dimensions`
 * field in the catalog.
 *
 * Hybrid bake strategy (see schema docstring):
 *   - If `dimensions` is set in the catalog, those values populate the
 *     fields and drive compile-time stride. Authors can hand-edit.
 *   - If unset, the GLTF-derived measurement is shown as the field
 *     value but is NOT persisted automatically — the author clicks
 *     "Recompute from GLTF" to commit it to the catalog. This avoids
 *     surprising writes when a user is just browsing the kind list.
 *
 * The GLTF is loaded via drei's `useGLTF` (cached by URL), so opening
 * a kind in this editor does not trigger a duplicate download even
 * when the preview canvas already has it loaded.
 */
function KindDimensionsEditor({
  gltfPath,
  scale,
  dimensions,
  applyPatch,
}: KindDimensionsEditorProps) {
  const gltf = useGLTF(gltfPath);
  const measuredDims = useMemo(
    () => getKindBoundingDimensions(gltf.scene, scale),
    [gltf.scene, scale],
  );
  const effective = dimensions ?? measuredDims;
  const isBaked = dimensions !== undefined;

  const update = (axis: 'width' | 'height' | 'depth', value: number) => {
    if (value <= 0) return;
    applyPatch({ dimensions: { ...effective, [axis]: value } });
  };

  // The bake script reads `data-measured-dims` to harvest the GLTF
  // AABB for every kind in a single Playwright pass without scraping
  // individual input values.
  const measuredAttr = `${measuredDims.width},${measuredDims.height},${measuredDims.depth}`;

  return (
    <div data-measured-dims={measuredAttr}>
      <NumberInput
        label="width"
        value={effective.width}
        min={0.05}
        max={64}
        step={0.05}
        onChange={(v) => update('width', v)}
      />
      <NumberInput
        label="height"
        value={effective.height}
        min={0.05}
        max={64}
        step={0.05}
        onChange={(v) => update('height', v)}
      />
      <NumberInput
        label="depth"
        value={effective.depth}
        min={0.05}
        max={64}
        step={0.05}
        onChange={(v) => update('depth', v)}
      />
      <div className="flex items-center justify-between gap-2 px-3 py-1">
        <span className="text-xs text-muted-foreground">
          {isBaked ? 'baked' : 'unbaked (using GLTF measurement)'}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => applyPatch({ dimensions: measuredDims })}
          title="Overwrite width/height/depth with the GLTF's current AABB extents."
        >
          Recompute from GLTF
        </Button>
      </div>
    </div>
  );
}

function DimensionsFallback() {
  return (
    <>
      <Readonly label="width" value="…" />
      <Readonly label="height" value="…" />
      <Readonly label="depth" value="…" />
    </>
  );
}

/** Tiny inline text field for the "label" row. Kept as a separate
 * component so the Field row matches the rest of the panel's
 * spacing without duplicating the label-cell markup. */
function LabelInput({ value, onChange }: LabelInputProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-1 min-h-7">
      <label className="w-[35%] shrink-0 text-[11px] text-muted-foreground">
        label
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="flex-1 min-w-0 rounded-sm border border-input bg-secondary px-2 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  );
}
