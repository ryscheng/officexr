import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_WORLD_CONSTANTS, type WorldConstants } from '@officexr/sdk';
import { GhostAvatarPanel } from './WorldPanels.tsx';

describe('GhostAvatarPanel', () => {
  it('shows an unknown saved model and removes it when None is chosen', () => {
    let doc: WorldConstants = { ...DEFAULT_WORLD_CONSTANTS, ghostAvatar: { model: '/models/x.glb' } };
    const edit = (update: (prev: WorldConstants) => WorldConstants) => {
      doc = update(doc);
    };
    render(<GhostAvatarPanel ghostAvatar={doc.ghostAvatar} edit={edit} />);
    const trigger = screen.getByRole('combobox');
    expect(trigger.textContent).toContain('/models/x.glb');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: "None (use player's character)" }));
    expect('ghostAvatar' in doc).toBe(false);
  });
});
