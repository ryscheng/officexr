import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_WORLD_CONSTANTS, type WorldConstants } from '@officexr/sdk';
import { GhostAvatarPanel, type SetSection } from './WorldPanels.tsx';

function setup(ghostAvatar: WorldConstants['ghostAvatar'], models?: { id: string; label: string; url: string }[]) {
  const state = { doc: { ...DEFAULT_WORLD_CONSTANTS, ghostAvatar } as WorldConstants };
  const setSection: SetSection = (key, update) => {
    state.doc = { ...state.doc, [key]: update(state.doc[key]) };
  };
  render(<GhostAvatarPanel ghostAvatar={ghostAvatar} setSection={setSection} models={models} />);
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
  return state;
}

describe('GhostAvatarPanel', () => {
  it('shows an unknown saved model and clears it when None is chosen', () => {
    const state = setup({ model: '/models/x.glb' });
    expect(screen.getAllByText('/models/x.glb').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('option', { name: "None (use player's character)" }));
    expect(state.doc.ghostAvatar).toBeUndefined();
    expect(JSON.parse(JSON.stringify(state.doc))).not.toHaveProperty('ghostAvatar');
  });

  it('writes the chosen model', () => {
    const state = setup(undefined, [{ id: 'g', label: 'Ghost', url: '/models/g.glb' }]);
    fireEvent.click(screen.getByRole('option', { name: 'Ghost' }));
    expect(state.doc.ghostAvatar).toEqual({ model: '/models/g.glb' });
  });
});
