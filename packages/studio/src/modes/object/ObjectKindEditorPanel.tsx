import React, { Suspense, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import {
  CUBE_KIND_CATEGORIES,
  type CubeKindCategory,
  type WorldObjectKind,
} from '@officexr/world';
import { getKindBoundingDimensions } from '@officexr/world/renderer';

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
          <KindDimensionsRows gltfPath={kind.gltfPath} scale={kind.scale} />
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
    </Panel>
  );
}

/** @deprecated Use ObjectKindEditorPanel */
export const KindEditorPanel = ObjectKindEditorPanel;

interface LabelInputProps {
  value: string;
  onChange: (next: string) => void;
}

interface KindDimensionsRowsProps {
  gltfPath: string;
  scale: number;
}

/**
 * Reads the kind's GLTF (drei caches by URL, so this shares the
 * same loaded scene the preview canvas already uses) and renders
 * width / height / depth in meters, post-`scale`. Suspends on
 * first load of a kind's GLTF — the parent renders a placeholder
 * fallback during that window.
 */
function KindDimensionsRows({ gltfPath, scale }: KindDimensionsRowsProps) {
  const gltf = useGLTF(gltfPath);
  const dims = useMemo(
    () => getKindBoundingDimensions(gltf.scene, scale),
    [gltf.scene, scale],
  );
  return (
    <>
      <Readonly label="width" value={formatMeters(dims.width)} />
      <Readonly label="height" value={formatMeters(dims.height)} />
      <Readonly label="depth" value={formatMeters(dims.depth)} />
    </>
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

function formatMeters(value: number): string {
  return `${value.toFixed(2)} m`;
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
