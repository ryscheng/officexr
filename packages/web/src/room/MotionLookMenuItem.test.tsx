// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MotionPermission } from '@officexr/world/renderer';
import { MotionLookMenuItem } from './MotionLookMenuItem';
import { RoomMenu } from './RoomMenu';

afterEach(cleanup);

function Harness({ result, onRecenter = () => {} }: { result: MotionPermission; onRecenter?: () => void }) {
  const [enabled, setEnabled] = useState(false);
  return (
    <RoomMenu>
      <MotionLookMenuItem
        enabled={enabled}
        onEnabledChange={setEnabled}
        onRecenter={onRecenter}
        requestPermission={() => Promise.resolve(result)}
      />
    </RoomMenu>
  );
}

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
const motionSwitch = () => screen.getByRole('switch', { name: 'Motion look' }) as HTMLInputElement;

describe('MotionLookMenuItem', () => {
  it('turns on when permission is granted, keeps the menu open and offers Recenter', async () => {
    const onRecenter = vi.fn();
    render(<Harness result="granted" onRecenter={onRecenter} />);
    openMenu();
    expect(screen.queryByRole('button', { name: 'Recenter' })).toBeNull();
    fireEvent.click(motionSwitch());
    await waitFor(() => expect(motionSwitch().checked).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Recenter' }));
    expect(onRecenter).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('stays off and explains when permission is denied', async () => {
    render(<Harness result="denied" />);
    openMenu();
    fireEvent.click(motionSwitch());
    await screen.findByText('Motion access denied — enable it in Safari settings');
    expect(motionSwitch().checked).toBe(false);
    expect(screen.queryByRole('button', { name: 'Recenter' })).toBeNull();
  });

  it('stays off, disabled, and explains when motion is unsupported', async () => {
    render(<Harness result="unsupported" />);
    openMenu();
    fireEvent.click(motionSwitch());
    expect((await screen.findByRole('status')).textContent).toBe('Not supported on this device');
    expect(motionSwitch().checked).toBe(false);
    expect(motionSwitch().disabled).toBe(true);
  });

  it('counts a failed permission request as denied', async () => {
    for (const requestPermission of [
      () => Promise.reject(new Error('not allowed')),
      () => {
        throw new Error('not allowed');
      },
    ]) {
      render(<MotionLookMenuItem enabled={false} onEnabledChange={() => {}} onRecenter={() => {}} requestPermission={requestPermission} />);
      fireEvent.click(motionSwitch());
      await screen.findByText('Motion access denied — enable it in Safari settings');
      expect(motionSwitch().disabled).toBe(false);
      cleanup();
    }
  });

  it('asks for permission synchronously within the tap and disables the switch meanwhile', async () => {
    let answer: (result: MotionPermission) => void = () => {};
    const requestPermission = vi.fn(() => new Promise<MotionPermission>((resolve) => (answer = resolve)));
    render(<MotionLookMenuItem enabled={false} onEnabledChange={() => {}} onRecenter={() => {}} requestPermission={requestPermission} />);
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
        <MotionLookMenuItem
          enabled={enabled}
          onEnabledChange={setEnabled}
          onRecenter={() => {}}
          requestPermission={requestPermission}
        />
      );
    }
    render(<Controlled />);
    fireEvent.click(motionSwitch());
    expect(motionSwitch().checked).toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
