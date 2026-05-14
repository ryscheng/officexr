import React from 'react';

import { Button } from '../../components/ui/button.tsx';
import {
  Panel,
  Section,
  SelectInput,
} from '../../ui/controls/index.ts';
import type { MapPickerState } from './useMapPicker.ts';

interface MapPickerPanelProps {
  picker: MapPickerState;
}

/**
 * Right-hand panel for Debug mode. Replaces the previous Leva
 * `useMapPicker` schema. Two controls:
 *
 *   - `map` dropdown: pick a saved map; load fires teleport +
 *     bot respawn (handled by the hook).
 *   - `Reload list`: re-fetch /api/maps for fresh entries.
 *   - `Reset & respawn`: re-apply the current map and warp bots.
 */
export function MapPickerPanel({ picker }: MapPickerPanelProps) {
  return (
    <Panel>
      <Section title="Map">
        <SelectInput
          label="name"
          value={picker.selected}
          options={picker.maps}
          onChange={picker.choose}
        />
        <div className="flex flex-col gap-1.5 px-3 py-2">
          <Button variant="secondary" size="sm" onClick={picker.reloadList}>
            Reload list
          </Button>
          <Button variant="default" size="sm" onClick={picker.reset}>
            Reset &amp; respawn
          </Button>
        </div>
      </Section>
    </Panel>
  );
}
