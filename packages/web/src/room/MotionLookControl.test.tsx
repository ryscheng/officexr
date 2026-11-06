// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MotionPermission } from '@officexr/world/renderer';
import { MotionLookControl } from './MotionLookControl';
import { openSettings, SettingsHarness } from './settingsHarness';

afterEach(cleanup);

function Harness({ result, onRecenter = () => {} }: { result: MotionPermission; onRecenter?: () => void }) {
  const [enabled, setEnabled] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  return (
    <SettingsHarness
      tabs={[
        {
          id: 'controls',
          label: 'Controls',
          content: (
            <MotionLookControl
              enabled={enabled}
              onEnabledChange={setEnabled}
              onRecenter={onRecenter}
              unsupported={unsupported}
              onUnsupported={() => setUnsupported(true)}
              requestPermission={() => Promise.resolve(result)}
            />
          ),
        },
      ]}
    />
  );
}

const motionSwitch = () => screen.getByRole('switch', { name: 'Motion look' }) as HTMLButtonElement;
const checked = () => motionSwitch().getAttribute('aria-checked') === 'true';

describe('MotionLookControl', () => {
  it('turns on when permission is granted, keeps Settings open and offers Recenter', async () => {
    const onRecenter = vi.fn();
    render(<Harness result="granted" onRecenter={onRecenter} />);
    openSettings();
    expect(screen.queryByRole('button', { name: 'Recenter' })).toBeNull();
    fireEvent.click(motionSwitch());
    await waitFor(() => expect(checked()).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Recenter' }));
    expect(onRecenter).toHaveBeenCalledTimes(1);
    expect(motionSwitch()).toBeTruthy();
  });

  it('stays off and explains when permission is denied', async () => {
    render(<Harness result="denied" />);
    openSettings();
    fireEvent.click(motionSwitch());
    await screen.findByText('Motion access denied — enable it in Safari settings');
    expect(checked()).toBe(false);
    expect(screen.queryByRole('button', { name: 'Recenter' })).toBeNull();
  });

  it('stays off, disabled, and explains when motion is unsupported', async () => {
    render(<Harness result="unsupported" />);
    openSettings();
    fireEvent.click(motionSwitch());
    expect((await screen.findByRole('status')).textContent).toBe('Not supported on this device');
    expect(checked()).toBe(false);
    expect(motionSwitch().disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    openSettings();
    expect(motionSwitch().disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Not supported on this device');
  });

  it('counts a failed permission request as denied', async () => {
    for (const requestPermission of [
      () => Promise.reject(new Error('not allowed')),
      () => {
        throw new Error('not allowed');
      },
    ]) {
      render(<MotionLookControl enabled={false} onEnabledChange={() => {}} onRecenter={() => {}} unsupported={false} onUnsupported={() => {}} requestPermission={requestPermission} />);
      fireEvent.click(motionSwitch());
      await screen.findByText('Motion access denied — enable it in Safari settings');
      expect(motionSwitch().disabled).toBe(false);
      cleanup();
    }
  });

  it('asks for permission synchronously within the tap and disables the switch meanwhile', async () => {
    let answer: (result: MotionPermission) => void = () => {};
    const requestPermission = vi.fn(() => new Promise<MotionPermission>((resolve) => (answer = resolve)));
    render(<MotionLookControl enabled={false} onEnabledChange={() => {}} onRecenter={() => {}} unsupported={false} onUnsupported={() => {}} requestPermission={requestPermission} />);
    fireEvent.click(motionSwitch());
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(motionSwitch().disabled).toBe(true);
    await act(async () => answer('denied'));
    expect(motionSwitch().disabled).toBe(false);
  });

  it('turns off without asking for permission again', async () => {
    const requestPermission = vi.fn(() => Promise.resolve<MotionPermission>('granted'));
    function Controlled() {
      const [enabled, setEnabled] = useState(true);
      return (
        <MotionLookControl
          enabled={enabled}
          onEnabledChange={setEnabled}
          onRecenter={() => {}}
          unsupported={false}
          onUnsupported={() => {}}
          requestPermission={requestPermission}
        />
      );
    }
    render(<Controlled />);
    fireEvent.click(motionSwitch());
    expect(checked()).toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
