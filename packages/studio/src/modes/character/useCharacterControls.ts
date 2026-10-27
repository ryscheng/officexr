import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHARACTERS, type CharacterName } from '@officexr/world';
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

export interface CharacterTuning {
  speedMultiplier: number;
  runSpeedMultiplier: number;
  charRadius: number;
  walkAnimSpeed: number;
  runAnimSpeed: number;
  idleAnimSpeed: number;
}

export interface CharacterEditorState {
  character: CharacterName;
  previewState: AnimationState;
  inControl: boolean;
  /** The full tuning surface for the current character. */
  tuning: CharacterTuning;
  /** Resolved per-character animation speeds for the active model
   * (current-tuning-or-saved-or-default). Same fields the canvas
   * consumes today. */
  idleAnimSpeed: number;
  walkAnimSpeed: number;
  runAnimSpeed: number;
  /** Setters the panel wires to controls. */
  setCharacter: (next: CharacterName) => void;
  setPreviewState: (next: AnimationState) => void;
  setInControl: (next: boolean) => void;
  setTuningField: <K extends keyof CharacterTuning>(
    key: K,
    value: CharacterTuning[K],
  ) => void;
  states: ReadonlyArray<AnimationState>;
}

const TUNING_DEFAULTS: CharacterTuning = {
  speedMultiplier: 1,
  runSpeedMultiplier: 0,
  charRadius: 0,
  walkAnimSpeed: 1,
  runAnimSpeed: 1,
  idleAnimSpeed: 1,
};

/**
 * Plain state hook for the Characters editor. No Leva. Owns:
 *
 *   - which character is selected
 *   - the preview animation state ("show me running")
 *   - the "take control (WASD)" toggle
 *   - per-character tuning (speed/radius/anim-speeds)
 *
 * Tuning persists to localStorage per character via `CharacterStorage`.
 * When the character switches, the hook loads that character's saved
 * tuning into local state. When a tuning field is edited, the hook
 * patches storage. The "transient extrude count"-style ref dance the
 * old Leva hook used is gone — fully controlled state replaces it.
 */
export function useCharacterControls(): CharacterEditorState {
  const storage = useMemo(() => new CharacterStorage(), []);
  const [configs, setConfigs] = useState<CharacterConfigs>(() => storage.load());
  const [character, setCharacter] = useState<CharacterName>(CHARACTERS[0]);
  const [previewState, setPreviewState] = useState<AnimationState>('idle');
  const [inControl, setInControl] = useState(false);

  const cfg = configs[character] ?? {};
  // The displayed tuning is local state (so a slider drag is fluid)
  // mirrored back into storage on commit.
  const [tuning, setTuning] = useState<CharacterTuning>(() =>
    tuningFromConfig(cfg),
  );

  // When the user picks a different character, load that one's
  // saved tuning into local state. `isSyncingRef` gates the
  // mirror-to-storage effect so the load doesn't get re-saved.
  const isSyncingRef = useRef(false);
  useEffect(() => {
    const newCfg = configs[character] ?? {};
    isSyncingRef.current = true;
    setTuning(tuningFromConfig(newCfg));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character]);

  // Mirror tuning → storage. `character` is intentionally absent
  // from the deps: we only persist when a tuning slider changes,
  // not when the character switches (that path is the load effect
  // above, which sets `isSyncingRef = true`).
  useEffect(() => {
    if (isSyncingRef.current) {
      isSyncingRef.current = false;
      return;
    }
    const patch: Partial<CharacterConfig> = {};
    // speedMultiplier=1 means "no override".
    patch.speedMultiplier =
      tuning.speedMultiplier === 1 ? undefined : tuning.speedMultiplier;
    // runSpeedMultiplier=0 → "inherit", charRadius=0 → "inherit".
    patch.runSpeedMultiplier =
      tuning.runSpeedMultiplier === 0 ? undefined : tuning.runSpeedMultiplier;
    patch.charRadius =
      tuning.charRadius === 0 ? undefined : tuning.charRadius;
    patch.walkAnimSpeed = tuning.walkAnimSpeed;
    patch.runAnimSpeed = tuning.runAnimSpeed;
    patch.idleAnimSpeed = tuning.idleAnimSpeed;
    setConfigs(storage.patch(character, patch));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tuning.speedMultiplier,
    tuning.runSpeedMultiplier,
    tuning.charRadius,
    tuning.walkAnimSpeed,
    tuning.runAnimSpeed,
    tuning.idleAnimSpeed,
  ]);

  const setTuningField = useCallback(
    <K extends keyof CharacterTuning>(key: K, value: CharacterTuning[K]) => {
      setTuning((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  return {
    character,
    previewState,
    inControl,
    tuning,
    idleAnimSpeed: tuning.idleAnimSpeed,
    walkAnimSpeed: tuning.walkAnimSpeed,
    runAnimSpeed: tuning.runAnimSpeed,
    setCharacter,
    setPreviewState: (next) => {
      setPreviewState(next);
      if (inControl) setInControl(false);
    },
    setInControl,
    setTuningField,
    states: STATES,
  };
}

function tuningFromConfig(cfg: CharacterConfig): CharacterTuning {
  return {
    speedMultiplier: cfg.speedMultiplier ?? TUNING_DEFAULTS.speedMultiplier,
    runSpeedMultiplier:
      cfg.runSpeedMultiplier ?? TUNING_DEFAULTS.runSpeedMultiplier,
    charRadius: cfg.charRadius ?? TUNING_DEFAULTS.charRadius,
    walkAnimSpeed: cfg.walkAnimSpeed ?? TUNING_DEFAULTS.walkAnimSpeed,
    runAnimSpeed: cfg.runAnimSpeed ?? TUNING_DEFAULTS.runAnimSpeed,
    idleAnimSpeed: cfg.idleAnimSpeed ?? TUNING_DEFAULTS.idleAnimSpeed,
  };
}
