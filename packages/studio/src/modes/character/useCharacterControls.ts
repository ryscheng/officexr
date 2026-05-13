import { useEffect, useMemo, useRef, useState } from 'react';
import { button, folder, useControls } from 'leva';
import {
  CHARACTERS,
  type CharacterName,
} from '@officexr/world';
import type { AnimationState } from '@officexr/world/renderer';
import type { CharacterConfig, CharacterConfigs } from '@officexr/sdk';
import { CharacterStorage } from './character-storage.ts';

const STATES: ReadonlyArray<AnimationState> = [
  'idle',
  'walking',
  'running',
  'jumping',
  'shooting',
  'throwing',
];

export interface CharacterEditorState {
  character: CharacterName;
  previewState: AnimationState;
  inControl: boolean;
  /** Resolved per-character animation speeds for the active model. */
  idleAnimSpeed: number;
  walkAnimSpeed: number;
  runAnimSpeed: number;
}

/**
 * Mounts the Characters editor's right-panel Leva controls and
 * returns the resolved editor state. Owns:
 *
 *   - Character selector (dropdown).
 *   - Animation state buttons (one Leva button per state) — each
 *     button updates `previewState`.
 *   - "Take control" toggle — when on, WASD drives the character
 *     and `previewState` is ignored (motion drives the clip).
 *   - Tuning folder — per-character speed / collision / animation
 *     overrides. Persists to localStorage; Debug mode reads from
 *     the same key on startup and broadcasts via world:characters.
 *
 * Storage is reused across character switches: switching models
 * loads that model's saved tuning into the Leva folder.
 */
export function useCharacterControls(): CharacterEditorState {
  const storage = useMemo(() => new CharacterStorage(), []);
  const [configs, setConfigs] = useState<CharacterConfigs>(() => storage.load());
  const [character, setCharacter] = useState<CharacterName>(CHARACTERS[0]);
  const [previewState, setPreviewState] = useState<AnimationState>('idle');
  const [inControl, setInControl] = useState(false);

  const cfg = configs[character] ?? {};

  // Top-level Character + Mode controls.
  useControls(
    'Character',
    {
      model: {
        value: character,
        options: CHARACTERS as unknown as string[],
        onChange: (v: string) => setCharacter(v as CharacterName),
        transient: true,
      },
      'Take control (WASD)': {
        value: inControl,
        onChange: (v: boolean) => setInControl(v),
        transient: true,
      },
    },
    [character, inControl],
  );

  // Animation-state buttons. Each one fires onClick → setPreviewState.
  // Disabled (visually unhighlighted) while in control, since motion
  // drives the clip then.
  useControls(
    'Animation',
    () => {
      const entries: Record<string, ReturnType<typeof button>> = {};
      for (const state of STATES) {
        const label = state[0].toUpperCase() + state.slice(1);
        const marker = previewState === state && !inControl ? '● ' : '  ';
        entries[`${marker}${label}`] = button(() => {
          setPreviewState(state);
          // Bringing back from "in control" mode also turns control off
          // so the picked state actually shows.
          if (inControl) setInControl(false);
        });
      }
      return entries;
    },
    [previewState, inControl],
  );

  // Tuning folder. useControls with a schema function returns [values, set, get].
  // We need the `set` handle to imperatively push values when character changes
  // because Leva's addData(..., override=true) updates settings (min/max/step)
  // but intentionally excludes the value field, so deps-based reinit doesn't
  // reset slider positions.
  const [tuningValues, setTuning] = useControls(
    'Tuning',
    () => ({
      _: folder(
        {
          speedMultiplier: {
            value: cfg.speedMultiplier ?? 1,
            min: 0.1,
            max: 3,
            step: 0.05,
            label: 'speed × (vs world)',
          },
          runSpeedMultiplier: {
            value: cfg.runSpeedMultiplier ?? 0,
            min: 0,
            max: 6,
            step: 0.1,
            label: 'run × (0 = inherit)',
          },
          charRadius: {
            value: cfg.charRadius ?? 0,
            min: 0,
            max: 1.5,
            step: 0.01,
            label: 'radius (0 = inherit)',
          },
          walkAnimSpeed: {
            value: cfg.walkAnimSpeed ?? 1,
            min: 0.1,
            max: 3,
            step: 0.05,
          },
          runAnimSpeed: {
            value: cfg.runAnimSpeed ?? 1,
            min: 0.1,
            max: 3,
            step: 0.05,
          },
          idleAnimSpeed: {
            value: cfg.idleAnimSpeed ?? 1,
            min: 0.1,
            max: 3,
            step: 0.05,
          },
        },
        { collapsed: true },
      ),
    }),
    [character],
  ) as unknown as [
    {
      speedMultiplier?: number;
      runSpeedMultiplier?: number;
      charRadius?: number;
      walkAnimSpeed?: number;
      runAnimSpeed?: number;
      idleAnimSpeed?: number;
    },
    (v: Record<string, number | undefined>) => void,
  ];

  // Guard: skip the persistence effect's first fire after a character switch.
  // Without this, the effect would run with the *old* tuning values and the
  // new character key, overwriting the new character's saved config.
  const isSyncingRef = useRef(false);

  // When character changes, push that character's saved config into Leva.
  // Must run before the persistence effect sees the changed tuningValues.
  useEffect(() => {
    const newCfg = configs[character] ?? {};
    isSyncingRef.current = true;
    setTuning({
      speedMultiplier: newCfg.speedMultiplier ?? 1,
      runSpeedMultiplier: newCfg.runSpeedMultiplier ?? 0,
      charRadius: newCfg.charRadius ?? 0,
      walkAnimSpeed: newCfg.walkAnimSpeed ?? 1,
      runAnimSpeed: newCfg.runAnimSpeed ?? 1,
      idleAnimSpeed: newCfg.idleAnimSpeed ?? 1,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character]);

  // Mirror Tuning → storage. `character` is intentionally absent from the
  // deps: we only want to save when a slider actually changes, not when the
  // character switches (that's handled by the sync effect above).
  useEffect(() => {
    if (isSyncingRef.current) {
      isSyncingRef.current = false;
      return;
    }
    const patch: Partial<CharacterConfig> = {};
    if (tuningValues.speedMultiplier != null && tuningValues.speedMultiplier !== 1) {
      patch.speedMultiplier = tuningValues.speedMultiplier;
    } else if (tuningValues.speedMultiplier === 1 && cfg.speedMultiplier != null) {
      patch.speedMultiplier = undefined;
    }
    if (tuningValues.runSpeedMultiplier != null) {
      patch.runSpeedMultiplier =
        tuningValues.runSpeedMultiplier === 0
          ? undefined
          : tuningValues.runSpeedMultiplier;
    }
    if (tuningValues.charRadius != null) {
      patch.charRadius =
        tuningValues.charRadius === 0 ? undefined : tuningValues.charRadius;
    }
    if (tuningValues.walkAnimSpeed != null) patch.walkAnimSpeed = tuningValues.walkAnimSpeed;
    if (tuningValues.runAnimSpeed != null) patch.runAnimSpeed = tuningValues.runAnimSpeed;
    if (tuningValues.idleAnimSpeed != null) patch.idleAnimSpeed = tuningValues.idleAnimSpeed;
    if (Object.keys(patch).length === 0) return;
    setConfigs(storage.patch(character, patch));
    // cfg captured via closure is current-render cfg; `character` read here is
    // always the character that owns the slider that just changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tuningValues.speedMultiplier,
    tuningValues.runSpeedMultiplier,
    tuningValues.charRadius,
    tuningValues.walkAnimSpeed,
    tuningValues.runAnimSpeed,
    tuningValues.idleAnimSpeed,
  ]);

  return {
    character,
    previewState,
    inControl,
    idleAnimSpeed: tuningValues.idleAnimSpeed ?? cfg.idleAnimSpeed ?? 1,
    walkAnimSpeed: tuningValues.walkAnimSpeed ?? cfg.walkAnimSpeed ?? 1,
    runAnimSpeed: tuningValues.runAnimSpeed ?? cfg.runAnimSpeed ?? 1,
  };
}
