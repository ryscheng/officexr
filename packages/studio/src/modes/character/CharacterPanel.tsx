import React from 'react';
import { CHARACTERS, type CharacterName } from '@officexr/world';
import type { AnimationState } from '@officexr/world/renderer';

import { Button } from '../../components/ui/button.tsx';
import {
  NumberInput,
  Panel,
  Section,
  SelectInput,
  Toggle,
} from '../../ui/controls/index.ts';
import type {
  CharacterEditorState,
  CharacterTuning,
} from './useCharacterControls.ts';

interface CharacterPanelProps {
  ctrl: CharacterEditorState;
}

/**
 * Right-hand panel for the Character editor. Replaces the Leva
 * tree previously mounted by `useCharacterControls`. Three
 * sections:
 *
 *   - Character: model picker + "Take control (WASD)" toggle.
 *   - Animation: one row per state (idle/walking/running/...);
 *     the currently-previewed state is highlighted.
 *   - Tuning: per-character speed/radius/anim-speed sliders.
 *     Persists to localStorage via the hook's mirror effect.
 */
export function CharacterPanel({ ctrl }: CharacterPanelProps) {
  return (
    <Panel>
      <Section title="Character">
        <SelectInput
          label="model"
          value={ctrl.character}
          options={CHARACTERS as unknown as readonly CharacterName[]}
          onChange={(model) => ctrl.setCharacter(model)}
        />
        <Toggle
          label="WASD control"
          value={ctrl.inControl}
          onChange={ctrl.setInControl}
          hint="When on, WASD drives the character (preview state is ignored)."
        />
      </Section>

      <Section title="Animation">
        <div className="flex flex-col gap-1 px-3 py-1.5">
          {ctrl.states.map((state) => {
            const active = !ctrl.inControl && ctrl.previewState === state;
            return (
              <Button
                key={state}
                size="sm"
                variant={active ? 'default' : 'outline'}
                onClick={() => ctrl.setPreviewState(state as AnimationState)}
                className="justify-start"
              >
                <span
                  aria-hidden
                  className="mr-2 inline-block w-3 text-center"
                >
                  {active ? '●' : ''}
                </span>
                {capitalize(state)}
              </Button>
            );
          })}
        </div>
      </Section>

      <Section title="Tuning" defaultOpen={false}>
        <TuningSlider
          label="speed ×"
          field="speedMultiplier"
          tuning={ctrl.tuning}
          setField={ctrl.setTuningField}
          min={0.1}
          max={3}
          step={0.05}
        />
        <TuningSlider
          label="run × (0 inherits)"
          field="runSpeedMultiplier"
          tuning={ctrl.tuning}
          setField={ctrl.setTuningField}
          min={0}
          max={6}
          step={0.1}
        />
        <TuningSlider
          label="radius (0 inherits)"
          field="charRadius"
          tuning={ctrl.tuning}
          setField={ctrl.setTuningField}
          min={0}
          max={1.5}
          step={0.01}
        />
        <TuningSlider
          label="walk anim ×"
          field="walkAnimSpeed"
          tuning={ctrl.tuning}
          setField={ctrl.setTuningField}
          min={0.1}
          max={3}
          step={0.05}
        />
        <TuningSlider
          label="run anim ×"
          field="runAnimSpeed"
          tuning={ctrl.tuning}
          setField={ctrl.setTuningField}
          min={0.1}
          max={3}
          step={0.05}
        />
        <TuningSlider
          label="idle anim ×"
          field="idleAnimSpeed"
          tuning={ctrl.tuning}
          setField={ctrl.setTuningField}
          min={0.1}
          max={3}
          step={0.05}
        />
      </Section>
    </Panel>
  );
}

interface TuningSliderProps {
  label: string;
  field: keyof CharacterTuning;
  tuning: CharacterTuning;
  setField: CharacterEditorState['setTuningField'];
  min: number;
  max: number;
  step: number;
}

function TuningSlider({ label, field, tuning, setField, min, max, step }: TuningSliderProps) {
  return (
    <NumberInput
      label={label}
      value={tuning[field]}
      min={min}
      max={max}
      step={step}
      onChange={(v) => setField(field, v)}
    />
  );
}

function capitalize(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}
